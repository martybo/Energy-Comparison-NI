/**
 * Display formatting. The only place rounding happens.
 *
 * A Year 1 total and its monthly average are each rounded from full precision,
 * so monthly x 12 will not generally equal the Year 1 figure. That is correct
 * and must not be reconciled by adjusting either number.
 */

export function gbp(value, { signed = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : signed ? '+' : '';
  const amount = Math.abs(value).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${sign}£${amount}`;
}

export function pence(value, dp = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(dp)}p`;
}

/** "£658.59 estimated Year 1" / "£54.88/month average in Year 1" */
export function year1Headline(result) {
  return `${gbp(result.year1.total)} estimated Year 1`;
}

export function year1Monthly(result) {
  return `${gbp(result.year1.averageMonthly)}/month average in Year 1`;
}

/** Never claims an ongoing figure that is not known (R1). */
export function ongoingHeadline(result) {
  if (!result.ongoingKnown) return 'Ongoing cost not known';
  return `${gbp(result.ongoing.total)}/year ongoing`;
}

export function ongoingMonthly(result) {
  if (!result.ongoingKnown) return null;
  return `${gbp(result.ongoing.averageMonthly)}/month ongoing`;
}

/** "Includes £130 welcome credit" — shown separately so ranking is explicable. */
export function creditSummary(result) {
  const oneOff = result.credits.filter((c) => !c.spreadable);
  const recurring = result.credits.filter((c) => c.spreadable);
  const parts = [];
  for (const c of oneOff) {
    const when =
      c.month != null
        ? ` (applied in month ${c.month})`
        : ' (timing not stated by the supplier)';
    parts.push(`Includes ${gbp(c.amountGbp)} welcome credit${when}`);
  }
  for (const c of recurring) {
    parts.push(`Includes ${gbp(c.amountGbp)} credit per ${c.frequency === 'annual' ? 'year' : 'month'}`);
  }
  return parts;
}

/** Contract and eligibility disclosure. Exit fee is a risk, not a cost (R3). */
export function conditionSummary(result) {
  const c = result.conditions;
  const parts = [];
  if (c.newCustomersOnly === true) parts.push('New customers only');
  if (c.contractType === 'fixed' && c.termMonths) parts.push(`${c.termMonths}-month fixed term`);
  if (c.contractType === 'unknown') parts.push('Contract terms not stated by the supplier');
  if (result.introPeriodBasis === 'no_incentive_advertised') {
    parts.push('No introductory offer listed, and no contract length stated');
  }
  if (typeof c.exitFeeGbp === 'number' && c.exitFeeGbp > 0) parts.push(`${gbp(c.exitFeeGbp)} exit fee if you leave early`);
  if (c.exitFeeGbp === 0) parts.push('No exit fee');
  if (result.introPeriodKnown && result.introPeriodMonths > 0) parts.push(`Introductory rate for ${result.introPeriodMonths} months`);
  if (!result.introPeriodKnown && result.headlineDiscountPct != null) parts.push('Discount duration not stated by the supplier');
  return parts.concat(c.notes);
}

export function datasetAgeDays(meta, now = new Date()) {
  if (!meta || !meta.effective_from) return null;
  const from = new Date(meta.effective_from + 'T00:00:00Z');
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((now.getTime() - from.getTime()) / 86400000);
}

/** Stale data must announce itself rather than pass as current (B3). */
export function datasetStatus(meta, now = new Date()) {
  const age = datasetAgeDays(meta, now);
  if (age === null) return { level: 'error', message: 'Tariff data has no effective date and cannot be trusted.' };
  if (age > 60) {
    return {
      level: 'error',
      age,
      message: `These rates are from ${meta.effective_from} and are about ${Math.round(age / 30)} months out of date. They are shown to demonstrate the comparison only and must not be used to choose a tariff.`
    };
  }
  if (age > 35) {
    return { level: 'warn', age, message: `These rates are from ${meta.effective_from} and may have changed.` };
  }
  return { level: 'ok', age, message: `Rates effective from ${meta.effective_from}.` };
}

/**
 * How to describe the payment method for a result.
 *
 * Where several methods cost exactly the same, naming one would imply the
 * customer must switch to it. The tie is stated instead (finding: the method
 * shown was previously decided by the order of the rates array).
 */
export function paymentMethodSummary(result, labels = {}) {
  const label = (m) => labels[m] || m;
  if (result.allPaymentMethodsTie) return 'Same price across all available payment methods';
  if (result.paymentMethodTie) {
    return `Same price on ${result.tiedPaymentMethods.map(label).join(', ')}`;
  }
  return label(result.paymentMethod);
}

/** Explains a usage-threshold discount cap, when one bites at this usage. */
export function capSummary(result) {
  const cap = result.discountCap;
  if (!cap) return null;
  if (!cap.applied) {
    return `Discount applies to the first ${gbp(cap.thresholdGbp)} of annual cost; your estimated usage is below that.`;
  }
  return `Discount is capped at the first ${gbp(cap.thresholdGbp)} of annual cost, so ${gbp(cap.adjustmentGbp)} of your usage is charged at the standard rate.`;
}

/**
 * The supplier states this cap per quarter as well as per year. We model the
 * annual figure because no quarterly consumption is collected, so a seasonal
 * customer's real bill can differ. Storage heating is seasonal, so this is
 * worth saying rather than burying.
 */
export function capLimitation(result) {
  return result.discountCap
    ? 'This supplier also applies the cap per quarter. The estimate uses the annual figure, so a bill that is much higher in winter could cost more than shown.'
    : null;
}

/**
 * "Day 30.179p/kWh · Night 13.997p/kWh · Standing charge 9.873p/day" for a
 * day/night tariff, or "30.179p/kWh · Standing charge 9.873p/day" for a
 * single-rate (standard) tariff. One function so a result card never has to
 * know which shape it is rendering.
 */
export function rateLine(result) {
  const standing = `Standing charge ${pence(result.rates.standingPPerDay)}/day`;
  if (result.meterType === 'standard') {
    return `${pence(result.rates.unitPPerKwh)}/kWh · ${standing}`;
  }
  return `Day ${pence(result.rates.dayPPerKwh)}/kWh · Night ${pence(result.rates.nightPPerKwh)}/kWh · ${standing}`;
}

/**
 * Cost, not availability. Every rendering of a compareMeterTypes() result
 * must show this alongside it: a cheaper tariff family here is not a claim
 * that a meter or tariff switch is actually available to this customer.
 */
export function meterTypeSwitchCaveat() {
  return 'This compares the cost of your total electricity consumption against available day/night and 24-hour tariffs. Check with the supplier that the tariff and meter arrangement are available to you before switching.';
}

/**
 * "Economy 7 looks cheaper for you" / "A 24-hour tariff looks cheaper for
 * your usage" / "The two options are very close for your estimated usage."
 * Never forces a winner inside compareMeterTypes()'s own tolerance.
 */
export function meterTypeVerdictHeadline(v) {
  switch (v.verdict) {
    case 'economy7':
      return 'Economy 7 looks cheaper for you';
    case 'standard':
      return 'A 24-hour tariff looks cheaper for your usage';
    case 'close':
      return 'The two options are very close for your estimated usage';
    case 'economy7_only':
    case 'standard_only':
      return 'Only one tariff family could be compared';
    default:
      return 'Not enough data to compare';
  }
}

/**
 * "Cheapest Economy 7 £757.52/year · Cheapest 24-hour £1,013.00/year ·
 * Estimated Economy 7 saving £255.48/year" — always states both totals when
 * both are known, so the reader can see the numbers a verdict was drawn from
 * rather than trusting a label alone.
 */
export function meterTypeVerdictDetail(v) {
  const parts = [];
  if (v.economy7) parts.push(`Cheapest Economy 7: ${gbp(v.economy7.year1.total)}/year`);
  if (v.standard) parts.push(`Cheapest 24-hour: ${gbp(v.standard.year1.total)}/year`);
  if (v.differenceGbp != null && v.verdict !== 'close') {
    const saver = v.verdict === 'economy7' ? 'Economy 7' : '24-hour';
    parts.push(`Estimated ${saver} saving: ${gbp(Math.abs(v.differenceGbp))}/year`);
  }
  return parts;
}
