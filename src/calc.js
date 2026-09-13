/**
 * Tariff cost calculation engine.
 *
 * Pure functions over a validated dataset. No DOM, no supplier-specific or
 * tariff-specific branching: every rule is driven by fields in the data, so
 * adding a supplier or tariff is a data change only.
 *
 * All arithmetic runs at full precision. Rounding is a display concern and
 * lives in format.js. A displayed monthly average multiplied by 12 will not
 * generally equal the displayed Year 1 total; that is expected.
 */

export const DAYS_PER_YEAR = 365;
/** Costs within a hundredth of a penny are the same price, not a ranking. */
export const TIE_EPSILON = 1e-4;
export const MONTHS_PER_YEAR = 12;

/** Build a usage object from average daily kWh. */
export function usageFromDaily(dayKwh, nightKwh) {
  return { annualDayKwh: dayKwh * DAYS_PER_YEAR, annualNightKwh: nightKwh * DAYS_PER_YEAR };
}

/** Build a usage object from an annual total and the share consumed at night. */
export function usageFromAnnualSplit(annualKwh, nightSharePct) {
  const night = annualKwh * (nightSharePct / 100);
  return { annualDayKwh: annualKwh - night, annualNightKwh: night };
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Percentage discounts that must be calculated, as opposed to discounts the
 * supplier has already baked into the published unit rate.
 *
 * R6: a percentage_discount on a record whose rate_basis is "discounted" is a
 * validation error (see validate.js) and is refused here as well, so a rate can
 * never be discounted twice even if an unvalidated dataset is passed in.
 */
function effectiveRates(tariff, rateRow, scope) {
  let day = rateRow.day_p_per_kwh;
  let night = rateRow.night_p_per_kwh;
  if (tariff.rate_basis === 'discounted') return { day, night };
  for (const adj of tariff.adjustments || []) {
    if (adj.type !== 'percentage_discount') continue;
    if (!appliesInScope(adj, scope)) continue;
    const factor = 1 - adj.pct / 100;
    const target = adj.applies_to || 'all';
    if (target === 'all' || target === 'day') day *= factor;
    if (target === 'all' || target === 'night') night *= factor;
  }
  return { day, night };
}

function appliesInScope(adj, scope) {
  const applies = adj.applies || 'first_year';
  if (scope === 'first_year') return applies === 'first_year' || applies === 'ongoing' || applies === 'intro_period';
  return applies === 'ongoing';
}

/** Annual energy + standing cost in pounds at a given rate row. */
function annualBase(tariff, rateRow, usage, scope) {
  const { day, night } = effectiveRates(tariff, rateRow, scope);
  const energy = (day * usage.annualDayKwh + night * usage.annualNightKwh) / 100;
  const standing = (rateRow.standing_p_per_day * DAYS_PER_YEAR) / 100;
  return { energy, standing, dayRate: day, nightRate: night };
}

/**
 * Cash adjustments over one year, split into the parts that may be spread
 * across billing periods and the one-off parts that may not (R5).
 *
 * Returns credits as positive numbers to be subtracted, charges as positive
 * numbers to be added. Exit fees are deliberately excluded: they are only
 * payable on early exit and are disclosed as a condition, not a cost (R3).
 */
function cashAdjustments(tariff, scope) {
  let oneOffCredit = 0;
  let recurringCreditPerYear = 0;
  let chargesPerYear = 0;
  const items = [];
  for (const adj of tariff.adjustments || []) {
    if (!appliesInScope(adj, scope)) continue;
    switch (adj.type) {
      case 'welcome_credit':
      case 'fixed_credit': {
        if (scope !== 'first_year') break;
        oneOffCredit += adj.amount_gbp;
        items.push({
          type: adj.type,
          amountGbp: adj.amount_gbp,
          spreadable: false,
          timing: adj.timing ?? 'unspecified',
          month: typeof adj.timing === 'object' && adj.timing ? (adj.timing.month ?? null) : null
        });
        break;
      }
      case 'recurring_credit': {
        const perYear = adj.frequency === 'annual' ? adj.amount_gbp : adj.amount_gbp * MONTHS_PER_YEAR;
        recurringCreditPerYear += perYear;
        items.push({ type: adj.type, amountGbp: adj.amount_gbp, frequency: adj.frequency, perYearGbp: perYear, spreadable: true, month: null });
        break;
      }
      case 'fixed_charge': {
        const perYear = adj.frequency === 'once' ? (scope === 'first_year' ? adj.amount_gbp : 0) : adj.amount_gbp;
        chargesPerYear += perYear;
        items.push({ type: adj.type, amountGbp: adj.amount_gbp, frequency: adj.frequency, perYearGbp: perYear, spreadable: adj.frequency !== 'once', month: null });
        break;
      }
      default:
        break; // percentage_discount handled in effectiveRates; unknown types ignored
    }
  }
  return { oneOffCredit, recurringCreditPerYear, chargesPerYear, items };
}

/**
 * Usage-threshold discount cap.
 *
 * Some suppliers apply a discount only to the first N pounds of annual spend at
 * their standard rate, charging the standard rate above it. The rule is
 * expressed generically: the discount covers the fraction of the year's
 * standard-rate spend that falls under the threshold, and the remainder is
 * charged at the standard rate.
 *
 *   f     = threshold / standard_cost           (share of the year covered)
 *   total = discounted_cost * f + standard_cost * (1 - f)
 *
 * Working from the two cost figures rather than a percentage means the rule
 * needs no supplier-specific arithmetic: any tariff naming a standard-rate
 * reference and a threshold is handled by the same code.
 */
function applyDiscountCap(tariff, rateRow, usage, scope, discountedCost, byId, warnings) {
  const cap = (tariff.adjustments || []).find(
    (a) => a.type === 'discount_cap' && appliesInScope(a, scope)
  );
  if (!cap) return null;
  const standard = byId.get(cap.standard_rate_ref);
  if (!standard) {
    warnings.push({ code: 'cap_standard_rate_missing', tariffId: tariff.id, message: `discount_cap references "${cap.standard_rate_ref}", which is not in the dataset; the cap could not be applied.` });
    return null;
  }
  const standardRate = findRate(standard, rateRow.payment_method) || standard.rates[0];
  if (!standardRate) return null;
  const b = annualBase(standard, standardRate, usage, scope);
  const standardCost = b.energy + b.standing;
  if (standardCost <= cap.threshold_gbp) {
    return { applied: false, adjustmentGbp: 0, standardCost, thresholdGbp: cap.threshold_gbp, savingGbp: standardCost - discountedCost, maxSavingGbp: cap.max_saving_gbp ?? null };
  }
  const covered = cap.threshold_gbp / standardCost;
  const capped = discountedCost * covered + standardCost * (1 - covered);
  return {
    applied: true,
    adjustmentGbp: capped - discountedCost,
    standardCost,
    thresholdGbp: cap.threshold_gbp,
    savingGbp: standardCost - capped,
    maxSavingGbp: cap.max_saving_gbp ?? null
  };
}

function findRate(tariff, paymentMethod) {
  if (!tariff.rates || tariff.rates.length === 0) return null;
  if (!paymentMethod) return null;
  return tariff.rates.find((r) => r.payment_method === paymentMethod) || null;
}

/**
 * Cost for one tariff on one payment method.
 *
 * Year 1 (R2) blends the introductory period with the reversion rate when the
 * introductory period is shorter than twelve months:
 *
 *   intro_period_months === 0     no introductory period; ongoing === year 1
 *   intro_period_months === null  unknown; Year 1 is priced at the published
 *                                 rate and ongoing cost is reported as unknown
 *   0 < n < 12                    n months at published rates + (12 - n) at the
 *                                 reversion rates named by reverts_to
 *   n >= 12                       Year 1 wholly at published rates; ongoing
 *                                 uses the reversion rates when they are known
 */
export function costFor(tariff, rateRow, usage, context = {}) {
  const byId = context.byId || new Map();
  const warnings = [];
  const intro = tariff.intro_period_months;
  const introKnown = intro !== null && intro !== undefined;

  const base = annualBase(tariff, rateRow, usage, 'first_year');
  const cash = cashAdjustments(tariff, 'first_year');

  // Resolve the tariff the customer moves onto once any introductory deal ends.
  let reversion = null;
  if (tariff.reverts_to) {
    const target = byId.get(tariff.reverts_to);
    if (!target) {
      warnings.push({ code: 'reverts_to_missing', tariffId: tariff.id, message: `reverts_to "${tariff.reverts_to}" does not match any tariff in the dataset.` });
    } else {
      let targetRate = findRate(target, rateRow.payment_method);
      if (!targetRate) {
        targetRate = target.rates[0];
        warnings.push({ code: 'reversion_payment_method_differs', tariffId: tariff.id, message: `Tariff "${target.id}" is not sold on ${rateRow.payment_method}; ongoing cost is estimated from its ${targetRate.payment_method} rate.` });
      }
      reversion = { tariff: target, rate: targetRate, base: annualBase(target, targetRate, usage, 'ongoing') };
    }
  }

  // --- Year 1 -------------------------------------------------------------
  let year1Energy = base.energy;
  let year1Standing = base.standing;
  let year1Complete = true;
  let blended = false;
  // Per-month rate basis, so the schedule shows the actual pattern rather than
  // a flat average that would conceal the step up after the introductory rate.
  let monthlyBase = Array.from({ length: MONTHS_PER_YEAR }, () => base);

  if (introKnown && intro > 0 && intro < MONTHS_PER_YEAR) {
    if (reversion) {
      const introShare = intro / MONTHS_PER_YEAR;
      const restShare = 1 - introShare;
      year1Energy = base.energy * introShare + reversion.base.energy * restShare;
      year1Standing = base.standing * introShare + reversion.base.standing * restShare;
      monthlyBase = Array.from({ length: MONTHS_PER_YEAR }, (_, i) => (i < intro ? base : reversion.base));
      blended = true;
    } else {
      // Priced wholly at the introductory rate, which understates Year 1.
      year1Complete = false;
      warnings.push({ code: 'reversion_unknown', tariffId: tariff.id, message: `Introductory period ends after ${intro} months but the reversion rate is unknown; Year 1 is priced at the introductory rate and is understated.` });
    }
  }

  const cap = applyDiscountCap(tariff, rateRow, usage, 'first_year', year1Energy + year1Standing, byId, warnings);
  const year1CapAdjustment = cap ? cap.adjustmentGbp : 0;
  const year1Gross = year1Energy + year1Standing + cash.chargesPerYear + year1CapAdjustment;
  const year1Credits = cash.oneOffCredit + cash.recurringCreditPerYear;
  const year1Total = year1Gross - year1Credits;

  // --- Ongoing (R1: unknown is a real state, never faked) -----------------
  let ongoing = null;
  if (introKnown) {
    const ongoingCash = cashAdjustments(tariff, 'ongoing');
    if (intro === 0) {
      const b = annualBase(tariff, rateRow, usage, 'ongoing');
      const ongoingCap = applyDiscountCap(tariff, rateRow, usage, 'ongoing', b.energy + b.standing, byId, []);
      ongoing = {
        energyCost: b.energy,
        standingCost: b.standing,
        charges: ongoingCash.chargesPerYear,
        credits: ongoingCash.recurringCreditPerYear,
        capAdjustment: ongoingCap ? ongoingCap.adjustmentGbp : 0,
        total: b.energy + b.standing + ongoingCash.chargesPerYear + (ongoingCap ? ongoingCap.adjustmentGbp : 0) - ongoingCash.recurringCreditPerYear,
        basis: 'same_rates'
      };
    } else if (reversion) {
      const revCash = cashAdjustments(reversion.tariff, 'ongoing');
      ongoing = {
        energyCost: reversion.base.energy,
        standingCost: reversion.base.standing,
        charges: revCash.chargesPerYear,
        credits: revCash.recurringCreditPerYear,
        total: reversion.base.energy + reversion.base.standing + revCash.chargesPerYear - revCash.recurringCreditPerYear,
        basis: 'reversion_rates',
        revertsToId: reversion.tariff.id,
        revertsToName: `${reversion.tariff.supplier} ${reversion.tariff.name}`
      };
    }
  }
  if (ongoing) ongoing.averageMonthly = ongoing.total / MONTHS_PER_YEAR;

  return {
    id: tariff.id,
    supplier: tariff.supplier,
    name: tariff.name,
    paymentMethod: rateRow.payment_method,
    rates: {
      dayPPerKwh: base.dayRate,
      nightPPerKwh: base.nightRate,
      standingPPerDay: rateRow.standing_p_per_day,
      basis: tariff.rate_basis
    },
    headlineDiscountPct: tariff.headline_discount_pct ?? null,
    year1: {
      energyCost: year1Energy,
      standingCost: year1Standing,
      charges: cash.chargesPerYear,
      creditsApplied: year1Credits,
      grossTotal: year1Gross,
      total: year1Total,
      averageMonthly: year1Total / MONTHS_PER_YEAR,
      creditExceedsCost: year1Credits > year1Gross, // R4: reported, never clamped
      blendedWithReversion: blended,
      capAdjustment: year1CapAdjustment,
      complete: year1Complete
    },
    discountCap: cap,
    ongoing,
    ongoingKnown: ongoing !== null,
    introPeriodMonths: introKnown ? intro : null,
    introPeriodKnown: introKnown,
    introPeriodBasis: tariff.intro_period_basis ?? null,
    credits: cash.items.filter((i) => i.type !== 'fixed_charge'),
    charges: cash.items.filter((i) => i.type === 'fixed_charge'),
    conditions: {
      contractType: tariff.contract?.type ?? 'unknown',
      termMonths: tariff.contract?.term_months ?? null,
      exitFeeGbp: tariff.contract?.exit_fee_gbp ?? null, // R3: disclosed, not costed
      newCustomersOnly: tariff.eligibility?.new_customers_only ?? null,
      notes: [tariff.notes, ...(tariff.eligibility?.notes || [])].filter(Boolean)
    },
    schedule: buildSchedule({ monthlyBase, charges: cash.chargesPerYear + year1CapAdjustment, items: cash.items }),
    warnings
  };
}

/**
 * Twelve-month view (R5 / the user's timing rule).
 *
 * Recurring credits and charges are spread because they genuinely recur.
 * One-off credits are placed in the month the source states, and when the
 * source does not state one they are left unplaced and reported separately,
 * so nothing implies a supplier deducts 1/12 of a welcome credit each month.
 */
export function buildSchedule({ monthlyBase, charges, items }) {
  const perMonthCharges = charges / MONTHS_PER_YEAR;
  const months = [];
  for (let m = 1; m <= MONTHS_PER_YEAR; m++) {
    const monthBase = monthlyBase[m - 1];
    const energyCost = monthBase.energy / MONTHS_PER_YEAR;
    const standingCost = monthBase.standing / MONTHS_PER_YEAR;
    let credits = 0;
    for (const item of items) {
      if (item.type === 'fixed_charge') continue;
      if (item.spreadable) credits += (item.perYearGbp ?? 0) / MONTHS_PER_YEAR;
      else if (item.month === m) credits += item.amountGbp;
    }
    months.push({
      month: m,
      energyCost,
      standingCost,
      charges: perMonthCharges,
      credits,
      total: energyCost + standingCost + perMonthCharges - credits
    });
  }
  const unplaced = items
    .filter((i) => i.type !== 'fixed_charge' && !i.spreadable && i.month === null)
    .reduce((sum, i) => sum + i.amountGbp, 0);
  return { months, unplacedCreditsGbp: unplaced };
}

/**
 * Rank every eligible tariff/payment-method pairing by estimated Year 1 cost.
 *
 * One result per tariff: where a tariff is sold on several payment methods the
 * cheapest eligible method is returned, so the list is ten distinct products
 * rather than ten rows of the same product. Several tariffs from one supplier
 * are allowed; no supplier diversity quota is applied.
 */
export function compare(dataset, options = {}) {
  const {
    usage,
    paymentMethod = null,
    limit = 10,
    includeWelcomeCredits = true,
    includeWithdrawn = false
  } = options;

  if (!usage || !isFiniteNumber(usage.annualDayKwh) || !isFiniteNumber(usage.annualNightKwh)) {
    throw new TypeError('usage must supply finite annualDayKwh and annualNightKwh values.');
  }
  if (usage.annualDayKwh < 0 || usage.annualNightKwh < 0) {
    throw new RangeError('usage values must not be negative.');
  }

  const tariffs = dataset.tariffs || [];
  const byId = new Map(tariffs.map((t) => [t.id, t]));
  const warnings = [];
  const results = [];

  for (const tariff of tariffs) {
    if (!includeWithdrawn && tariff.status === 'withdrawn') continue;
    const candidateRates = paymentMethod
      ? (tariff.rates || []).filter((r) => r.payment_method === paymentMethod)
      : tariff.rates || [];
    if (candidateRates.length === 0) continue;

    const priced = candidateRates.map((rateRow) => costFor(tariff, rateRow, usage, { byId }));
    for (const p of priced) warnings.push(...p.warnings);

    if (!includeWelcomeCredits) {
      for (const p of priced) {
        const oneOff = p.credits.filter((c) => !c.spreadable).reduce((s, c) => s + c.amountGbp, 0);
        p.year1.creditsApplied -= oneOff;
        p.year1.total += oneOff;
        p.year1.averageMonthly = p.year1.total / MONTHS_PER_YEAR;
        p.year1.creditExceedsCost = p.year1.creditsApplied > p.year1.grossTotal;
        p.credits = p.credits.filter((c) => c.spreadable);
        p.schedule = buildSchedule({
          monthlyBase: p.schedule.months.map((m) => ({ energy: m.energyCost * MONTHS_PER_YEAR, standing: m.standingCost * MONTHS_PER_YEAR })),
          charges: p.year1.charges,
          items: p.credits
        });
        p.creditsExcludedFromRanking = true;
      }
    }

    // Cheapest payment method wins the slot; the alternatives ride along.
    //
    // Where several methods cost exactly the same there is no cheapest one, so
    // the tie is recorded rather than resolved arbitrarily. Ordering falls back
    // to the method slug, which makes the choice independent of the order the
    // rates happen to appear in the data file.
    priced.sort(
      (a, b) => a.year1.total - b.year1.total || a.paymentMethod.localeCompare(b.paymentMethod)
    );
    const best = priced[0];
    const tied = priced
      .filter((p) => Math.abs(p.year1.total - best.year1.total) < TIE_EPSILON)
      .map((p) => p.paymentMethod)
      .sort();
    best.tiedPaymentMethods = tied;
    best.paymentMethodTie = tied.length > 1;
    best.allPaymentMethodsTie = tied.length > 1 && tied.length === priced.length;
    best.alternativePaymentMethods = priced.slice(1).map((p) => ({
      paymentMethod: p.paymentMethod,
      year1Total: p.year1.total,
      standingPPerDay: p.rates.standingPPerDay,
      sameCost: Math.abs(p.year1.total - best.year1.total) < TIE_EPSILON
    }));
    results.push(best);
  }

  // Full precision throughout; ties broken deterministically so the order does
  // not depend on the position of a record in the data file (R7).
  results.sort(
    (a, b) =>
      a.year1.total - b.year1.total ||
      a.supplier.localeCompare(b.supplier) ||
      a.name.localeCompare(b.name)
  );

  return {
    results: limit > 0 ? results.slice(0, limit) : results,
    totalConsidered: results.length,
    dataset: dataset.dataset || {},
    paymentMethodLabels: dataset.payment_methods || {},
    warnings
  };
}
