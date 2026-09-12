/**
 * Dataset validation.
 *
 * The tariff data is the foundation of the service, so a malformed record must
 * be refused rather than quietly costed. Validation separates three outcomes:
 *
 *   errors    the record cannot be costed safely and is excluded
 *   warnings  the record is usable but something is missing or unverified
 *   valid     records safe to hand to the calculation engine
 *
 * A genuine zero is always valid data. Absent, null, non-numeric, NaN and
 * numeric strings are malformed. "Unknown" is expressed as null only in the
 * fields documented to allow it (contract terms, eligibility, intro period).
 */

export const PAYMENT_METHODS = [
  'prepayment',
  'direct_debit_ebill',
  'direct_debit_postal',
  'on_receipt_ebill',
  'on_receipt_postal'
];

export const ADJUSTMENT_TYPES = [
  'percentage_discount',
  'welcome_credit',
  'fixed_credit',
  'recurring_credit',
  'fixed_charge',
  'discount_cap'
];

const RATE_BASES = ['standard', 'discounted'];
/** Scope an adjustment applies in. An unrecognised value would silently drop
 *  the adjustment from every calculation, so it is an error, not a default. */
export const APPLIES_SCOPES = ['first_year', 'ongoing', 'intro_period'];
const CAP_BASES = ['annual_spend_at_standard_rate'];
const DISCOUNT_WORDINGS = ['exact', 'up_to'];
/**
 * Why intro_period_months holds the value it does.
 *
 * A bare 0 used to mean two different things — the source says there is no
 * fixed term, or nobody found an incentive so we assumed there wasn't one.
 * That ambiguity is what let a 12-month introductory discount be recorded as
 * a perpetual rate in the previous dataset. The basis is now explicit.
 */
export const INTRO_PERIOD_BASES = [
  'stated_no_fixed_term',
  'stated_fixed_term',
  'no_incentive_advertised',
  'unstated'
];
const STATUSES = ['active', 'withdrawn', 'incomplete'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real, finite number. Zero passes; null, undefined, NaN and "12.3" do not. */
function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidDate(v) {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function validateDataset(dataset) {
  const errors = [];
  const warnings = [];

  if (!dataset || typeof dataset !== 'object') {
    return { valid: [], rejected: [], errors: [{ code: 'dataset_missing', message: 'Dataset is missing or not an object.' }], warnings: [], dataset: {} };
  }

  const meta = dataset.dataset || {};
  if (!isValidDate(meta.effective_from)) {
    errors.push({ code: 'effective_from_invalid', message: 'dataset.effective_from must be a valid YYYY-MM-DD date.' });
  }
  if (meta.published !== undefined && meta.published !== null && !isValidDate(meta.published)) {
    errors.push({ code: 'published_invalid', message: 'dataset.published must be a valid YYYY-MM-DD date when present.' });
  }
  if (!meta.source) {
    warnings.push({ code: 'source_missing', message: 'dataset.source is not set; results cannot cite their origin.' });
  }
  if (meta.vat_treatment !== 'inclusive' && meta.vat_treatment !== 'exclusive') {
    warnings.push({ code: 'vat_unknown', message: 'dataset.vat_treatment is not stated as inclusive or exclusive; totals cannot be described as VAT-inclusive.' });
  }
  if (meta.conditions_verified === false) {
    warnings.push({ code: 'conditions_unverified', message: 'Contract terms, exit fees and eligibility in this dataset are unverified.' });
  }

  const valid = [];
  const rejected = [];
  const seenIds = new Set();

  for (const [index, tariff] of (dataset.tariffs || []).entries()) {
    const where = tariff?.id || `tariffs[${index}]`;
    const problems = [];
    const notes = [];

    if (!tariff || typeof tariff !== 'object') {
      rejected.push({ where, problems: [{ code: 'not_an_object', message: 'Tariff record is not an object.' }] });
      continue;
    }
    if (typeof tariff.id !== 'string' || tariff.id.trim() === '') {
      problems.push({ code: 'id_missing', message: 'id is required.' });
    } else if (seenIds.has(tariff.id)) {
      problems.push({ code: 'id_duplicate', message: `id "${tariff.id}" is used by more than one tariff.` });
    } else {
      seenIds.add(tariff.id);
    }
    if (typeof tariff.supplier !== 'string' || tariff.supplier.trim() === '') {
      problems.push({ code: 'supplier_missing', message: 'supplier is required.' });
    }
    if (typeof tariff.name !== 'string' || tariff.name.trim() === '') {
      problems.push({ code: 'name_missing', message: 'name is required.' });
    }
    if (tariff.status !== undefined && !STATUSES.includes(tariff.status)) {
      problems.push({ code: 'status_invalid', message: `status must be one of ${STATUSES.join(', ')}.` });
    }
    if (!RATE_BASES.includes(tariff.rate_basis)) {
      problems.push({ code: 'rate_basis_invalid', message: `rate_basis must be one of ${RATE_BASES.join(', ')}.` });
    }

    // intro_period_months: null means unknown, 0 means no introductory period.
    const intro = tariff.intro_period_months;
    if (intro !== null && intro !== undefined && (!isNumber(intro) || intro < 0)) {
      problems.push({ code: 'intro_period_invalid', message: 'intro_period_months must be null (unknown) or a non-negative number.' });
    }
    if (intro === null || intro === undefined) {
      notes.push({ code: 'ongoing_cost_unknown', message: 'intro_period_months is unknown, so ongoing cost cannot be estimated.' });
    }

    // intro_period_basis records where the value came from.
    const basis = tariff.intro_period_basis;
    if (basis !== undefined && !INTRO_PERIOD_BASES.includes(basis)) {
      problems.push({ code: 'intro_basis_invalid', message: `intro_period_basis must be one of ${INTRO_PERIOD_BASES.join(', ')}.` });
    }
    if (basis === 'unstated' && intro !== null && intro !== undefined) {
      problems.push({ code: 'intro_basis_contradiction', message: 'intro_period_basis is "unstated", so intro_period_months must be null rather than an inferred value.' });
    }
    // The guard that makes the previous dataset's error impossible: a tariff
    // advertising a discount or a credit cannot claim no incentive was found.
    const advertisesIncentive =
      (tariff.headline_discount_pct !== null && tariff.headline_discount_pct !== undefined) ||
      (tariff.adjustments || []).some((a) => a.type === 'welcome_credit' || a.type === 'fixed_credit' || a.type === 'percentage_discount');
    if (basis === 'no_incentive_advertised' && advertisesIncentive) {
      problems.push({ code: 'intro_basis_unsupported', message: 'intro_period_basis is "no_incentive_advertised" but this tariff advertises a discount or credit. Its duration must come from the source, or intro_period_months must be null.' });
    }
    if (isNumber(intro) && intro > 0 && !tariff.reverts_to) {
      notes.push({ code: 'reversion_unknown', message: 'An introductory period is declared but reverts_to is not set; ongoing cost cannot be estimated.' });
    }

    // Rates. A withdrawn tariff is a historical record and need not carry any,
    // since the source stops publishing rates for it.
    const withdrawn = tariff.status === 'withdrawn';
    if (!Array.isArray(tariff.rates) || (tariff.rates.length === 0 && !withdrawn)) {
      problems.push({ code: 'rates_missing', message: 'At least one rate row is required unless the tariff is withdrawn.' });
    } else {
      const seenMethods = new Set();
      for (const [ri, rate] of tariff.rates.entries()) {
        const at = `rates[${ri}]`;
        if (!rate || typeof rate !== 'object') {
          problems.push({ code: 'rate_not_an_object', message: `${at} is not an object.` });
          continue;
        }
        if (!PAYMENT_METHODS.includes(rate.payment_method)) {
          problems.push({ code: 'payment_method_invalid', message: `${at}.payment_method "${rate.payment_method}" is not a recognised payment method.` });
        } else if (seenMethods.has(rate.payment_method)) {
          problems.push({ code: 'payment_method_duplicate', message: `${at}.payment_method "${rate.payment_method}" appears more than once on this tariff.` });
        } else {
          seenMethods.add(rate.payment_method);
        }
        for (const field of ['day_p_per_kwh', 'night_p_per_kwh', 'standing_p_per_day']) {
          const v = rate[field];
          if (v === undefined || v === null) {
            problems.push({ code: 'rate_field_missing', message: `${at}.${field} is missing.` });
          } else if (!isNumber(v)) {
            problems.push({ code: 'rate_field_not_numeric', message: `${at}.${field} must be a number, received ${JSON.stringify(v)}.` });
          } else if (v < 0) {
            problems.push({ code: 'rate_field_negative', message: `${at}.${field} must not be negative.` });
          }
        }
      }
    }

    // Adjustments
    for (const [ai, adj] of (tariff.adjustments || []).entries()) {
      const at = `adjustments[${ai}]`;
      if (!adj || typeof adj !== 'object') {
        problems.push({ code: 'adjustment_not_an_object', message: `${at} is not an object.` });
        continue;
      }
      if (!ADJUSTMENT_TYPES.includes(adj.type)) {
        problems.push({ code: 'adjustment_type_invalid', message: `${at}.type "${adj.type}" is not a recognised adjustment type.` });
        continue;
      }
      // An unrecognised scope silently removes the adjustment from every
      // calculation, so a typo here would quietly delete a credit.
      if (adj.applies !== undefined && !APPLIES_SCOPES.includes(adj.applies)) {
        problems.push({ code: 'applies_invalid', message: `${at}.applies "${adj.applies}" is not one of ${APPLIES_SCOPES.join(', ')}. An unrecognised scope would silently drop this adjustment from the calculation.` });
      }
      if (adj.type === 'discount_cap') {
        if (!CAP_BASES.includes(adj.basis)) {
          problems.push({ code: 'cap_basis_invalid', message: `${at}.basis must be one of ${CAP_BASES.join(', ')}.` });
        }
        if (!isNumber(adj.threshold_gbp) || adj.threshold_gbp <= 0) {
          problems.push({ code: 'cap_threshold_invalid', message: `${at}.threshold_gbp must be a positive number.` });
        }
        if (typeof adj.standard_rate_ref !== 'string' || adj.standard_rate_ref.trim() === '') {
          problems.push({ code: 'cap_reference_missing', message: `${at}.standard_rate_ref is required so the standard rate above the threshold can be priced.` });
        }
        if (adj.max_saving_gbp !== undefined && adj.max_saving_gbp !== null && (!isNumber(adj.max_saving_gbp) || adj.max_saving_gbp < 0)) {
          problems.push({ code: 'cap_max_saving_invalid', message: `${at}.max_saving_gbp must be a non-negative number when present.` });
        }
        continue;
      }
      if (adj.type === 'percentage_discount') {
        // R6: refuse a discount that would be applied on top of an already
        // discounted published rate. This is an error, not a silent skip.
        if (tariff.rate_basis === 'discounted') {
          problems.push({
            code: 'discount_double_application',
            message: `${at} declares a percentage_discount but rate_basis is "discounted", so the published rates already include it. Applying it again would double-count the discount.`
          });
        }
        if (!isNumber(adj.pct) || adj.pct < 0 || adj.pct > 100) {
          problems.push({ code: 'discount_pct_invalid', message: `${at}.pct must be a number between 0 and 100.` });
        }
        if (adj.applies_to !== undefined && !['all', 'day', 'night'].includes(adj.applies_to)) {
          problems.push({ code: 'discount_scope_invalid', message: `${at}.applies_to must be all, day or night.` });
        }
      } else {
        if (!isNumber(adj.amount_gbp) || adj.amount_gbp < 0) {
          problems.push({ code: 'adjustment_amount_invalid', message: `${at}.amount_gbp must be a non-negative number.` });
        }
      }
      if (adj.type === 'recurring_credit' && !['monthly', 'annual'].includes(adj.frequency)) {
        problems.push({ code: 'frequency_invalid', message: `${at}.frequency must be monthly or annual.` });
      }
      if (adj.type === 'fixed_charge' && !['once', 'annual'].includes(adj.frequency)) {
        problems.push({ code: 'frequency_invalid', message: `${at}.frequency must be once or annual.` });
      }
      if ((adj.type === 'welcome_credit' || adj.type === 'fixed_credit') && adj.timing === undefined) {
        notes.push({ code: 'credit_timing_unspecified', message: `${at} does not state when the credit is applied; it is counted in the Year 1 total but not placed in a billing period.` });
      }
      if (typeof adj.timing === 'object' && adj.timing !== null) {
        const m = adj.timing.month;
        if (!isNumber(m) || m < 1 || m > 12 || !Number.isInteger(m)) {
          problems.push({ code: 'credit_timing_invalid', message: `${at}.timing.month must be a whole number between 1 and 12.` });
        }
      }
    }

    // Headline discount is display metadata only and must never be calculated.
    if (tariff.headline_discount_pct !== null && tariff.headline_discount_pct !== undefined && !isNumber(tariff.headline_discount_pct)) {
      problems.push({ code: 'headline_discount_invalid', message: 'headline_discount_pct must be a number or null.' });
    }
    if (tariff.headline_discount_wording !== null && tariff.headline_discount_wording !== undefined && !DISCOUNT_WORDINGS.includes(tariff.headline_discount_wording)) {
      problems.push({ code: 'headline_wording_invalid', message: `headline_discount_wording must be one of ${DISCOUNT_WORDINGS.join(', ')} or null.` });
    }

    const exitFee = tariff.contract?.exit_fee_gbp;
    if (exitFee !== null && exitFee !== undefined && (!isNumber(exitFee) || exitFee < 0)) {
      problems.push({ code: 'exit_fee_invalid', message: 'contract.exit_fee_gbp must be null (unknown) or a non-negative number.' });
    }

    if (problems.length > 0) {
      rejected.push({ where, supplier: tariff.supplier, name: tariff.name, problems });
    } else {
      valid.push(tariff);
      for (const n of notes) warnings.push({ ...n, tariffId: tariff.id });
    }
  }

  // Cross-record references can only be checked once every id is known. A
  // dangling reference means an ongoing cost or a capped rate cannot be priced.
  const validIds = new Set(valid.map((t) => t.id));
  for (let i = valid.length - 1; i >= 0; i--) {
    const tariff = valid[i];
    const fatal = [];

    // A dangling reverts_to costs only the ongoing figure; Year 1 is still
    // priced correctly and the engine reports ongoing as unknown. Rejecting the
    // record would hide a perfectly priceable tariff from the comparison, so
    // this is a warning.
    if (tariff.reverts_to && !validIds.has(tariff.reverts_to)) {
      warnings.push({ code: 'reverts_to_unresolved', tariffId: tariff.id, message: `reverts_to "${tariff.reverts_to}" does not match any valid tariff; ongoing cost will be reported as unknown.` });
    }

    // A dangling cap reference is different: the discount cap cannot be applied,
    // so the tariff would be priced too cheaply and could be ranked above
    // tariffs that are genuinely cheaper. That must not reach a consumer.
    for (const adj of tariff.adjustments || []) {
      if (adj.type === 'discount_cap' && adj.standard_rate_ref && !validIds.has(adj.standard_rate_ref)) {
        fatal.push({ code: 'cap_reference_unresolved', message: `discount_cap.standard_rate_ref "${adj.standard_rate_ref}" does not match any valid tariff, so the cap cannot be applied and the tariff would be priced too cheaply.` });
      }
    }
    if (fatal.length > 0) {
      valid.splice(i, 1);
      rejected.push({ where: tariff.id, supplier: tariff.supplier, name: tariff.name, problems: fatal });
    }
  }

  for (const r of rejected) {
    for (const p of r.problems) {
      errors.push({ ...p, tariffId: r.where });
    }
  }

  return {
    valid,
    rejected,
    errors,
    warnings,
    dataset: meta,
    paymentMethods: dataset.payment_methods || {}
  };
}

/** Validate, then return a dataset containing only the records safe to cost. */
export function loadValidated(dataset) {
  const report = validateDataset(dataset);
  return {
    report,
    dataset: {
      ...dataset,
      tariffs: report.valid
    }
  };
}
