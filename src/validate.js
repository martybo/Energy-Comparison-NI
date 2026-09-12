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
  'fixed_charge'
];

const RATE_BASES = ['standard', 'discounted'];
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
    if (isNumber(intro) && intro > 0 && !tariff.reverts_to) {
      notes.push({ code: 'reversion_unknown', message: 'An introductory period is declared but reverts_to is not set; ongoing cost cannot be estimated.' });
    }

    // Rates
    if (!Array.isArray(tariff.rates) || tariff.rates.length === 0) {
      problems.push({ code: 'rates_missing', message: 'At least one rate row is required.' });
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
