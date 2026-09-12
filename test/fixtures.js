/**
 * Deterministic fixtures. Round numbers throughout so expected costs can be
 * verified by hand, independently of the engine and of the real dataset.
 */

export const USAGE = { annualDayKwh: 1000, annualNightKwh: 2000 };

/** Plain variable tariff: 20p day, 10p night, 10p/day standing, no incentives.
 *  Year 1 = (20*1000 + 10*2000)/100 + 10*365/100 = 400 + 36.50 = 436.50 */
export const plain = {
  id: 'acme-basic',
  supplier: 'Acme Power',
  name: 'Basic',
  status: 'active',
  rate_basis: 'standard',
  headline_discount_pct: null,
  intro_period_months: 0,
  reverts_to: null,
  contract: { type: 'variable', term_months: null, exit_fee_gbp: 0 },
  eligibility: { new_customers_only: false, notes: [] },
  rates: [
    { payment_method: 'direct_debit_ebill', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 },
    { payment_method: 'prepayment', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 20 }
  ],
  adjustments: [],
  notes: null
};

/** Same rates as `plain`, plus a £120 welcome credit with no stated timing. */
export const withCredit = {
  ...plain,
  id: 'acme-welcome',
  name: 'Welcome',
  adjustments: [{ type: 'welcome_credit', amount_gbp: 120, applies: 'first_year', timing: 'unspecified' }]
};

/** £120 welcome credit the supplier states is applied in the first month. */
export const withTimedCredit = {
  ...plain,
  id: 'acme-welcome-timed',
  name: 'Welcome Timed',
  adjustments: [{ type: 'welcome_credit', amount_gbp: 120, applies: 'first_year', timing: { month: 1 } }]
};

/** £5/month credit that genuinely recurs, and continues beyond year one. */
export const withRecurringCredit = {
  ...plain,
  id: 'acme-recurring',
  name: 'Recurring',
  adjustments: [{ type: 'recurring_credit', amount_gbp: 5, applies: 'ongoing', frequency: 'monthly' }]
};

/** Published rates are the standard rates; a 25% discount must be calculated. */
export const withCalculatedDiscount = {
  ...plain,
  id: 'acme-calc-discount',
  name: 'Calculated Discount',
  rate_basis: 'standard',
  headline_discount_pct: 25,
  intro_period_months: 12,
  reverts_to: 'acme-basic',
  adjustments: [{ type: 'percentage_discount', pct: 25, applies: 'first_year', applies_to: 'all' }],
  rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 }]
};

/** Published rates already include the discount; it must not be applied again. */
export const withBakedInDiscount = {
  ...plain,
  id: 'acme-baked-discount',
  name: 'Baked In Discount',
  rate_basis: 'discounted',
  headline_discount_pct: 25,
  adjustments: [],
  rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 15, night_p_per_kwh: 7.5, standing_p_per_day: 10 }]
};

/** Six-month introductory rate reverting to `plain`. */
export const withShortIntro = {
  ...plain,
  id: 'acme-six-month',
  name: 'Six Month Intro',
  intro_period_months: 6,
  reverts_to: 'acme-basic',
  contract: { type: 'fixed', term_months: 12, exit_fee_gbp: 50 },
  rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 10, night_p_per_kwh: 5, standing_p_per_day: 10 }]
};

/** Intro period declared but the reversion tariff is unknown. */
export const withUnknownReversion = {
  ...withShortIntro,
  id: 'acme-six-month-unknown',
  name: 'Six Month Unknown',
  reverts_to: null
};

/** Discount duration entirely unstated: ongoing cost is unknowable. */
export const withUnknownIntro = {
  ...plain,
  id: 'acme-unknown-intro',
  name: 'Unknown Intro',
  rate_basis: 'discounted',
  headline_discount_pct: 30,
  intro_period_months: null,
  contract: { type: 'unknown', term_months: null, exit_fee_gbp: null },
  eligibility: { new_customers_only: null, notes: [] },
  rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 14, night_p_per_kwh: 7, standing_p_per_day: 10 }]
};

export function datasetOf(...tariffs) {
  return {
    schema_version: 1,
    dataset: {
      effective_from: '2025-08-01',
      published: '2025-08-04',
      source: 'Test fixture',
      vat_treatment: 'inclusive',
      rate_unit: 'pence_per_kwh',
      standing_unit: 'pence_per_day',
      conditions_verified: true
    },
    payment_methods: {
      prepayment: 'Prepayment',
      direct_debit_ebill: 'Direct Debit (e-bill)',
      direct_debit_postal: 'Direct Debit (postal bill)',
      on_receipt_ebill: 'Pay on receipt of e-bill',
      on_receipt_postal: 'Pay on receipt of bill'
    },
    tariffs
  };
}

/** Standard rate a capped tariff is measured against.
 *  At USAGE: (20*1000 + 10*2000)/100 = 400 energy + 36.50 standing = 436.50 */
export const capStandard = {
  ...plain,
  id: 'acme-standard',
  name: 'Standard',
  rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 }]
};

/** 10% off the standard rate, but only on the first £200 of annual cost.
 *  Uncapped: (18*1000 + 9*2000)/100 = 360 + 32.85 = 392.85
 *  Capped at £200 of a £436.50 standard year:
 *    covered = 200/436.50, total = 392.85*covered + 436.50*(1-covered) = 416.50
 *    saving  = 436.50 - 416.50 = 20.00, i.e. exactly 10% of the £200 threshold */
export const withDiscountCap = {
  ...plain,
  id: 'acme-capped',
  name: 'Capped Discount',
  rate_basis: 'discounted',
  headline_discount_pct: 10,
  rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 18, night_p_per_kwh: 9, standing_p_per_day: 9 }],
  adjustments: [{
    type: 'discount_cap', applies: 'ongoing', basis: 'annual_spend_at_standard_rate',
    threshold_gbp: 200, standard_rate_ref: 'acme-standard', max_saving_gbp: 20
  }]
};

/** Same tariff, threshold above the customer's whole year: cap must not bite. */
export const withUnreachedCap = {
  ...withDiscountCap,
  id: 'acme-uncapped',
  name: 'Uncapped Discount',
  adjustments: [{ ...withDiscountCap.adjustments[0], threshold_gbp: 1000, max_saving_gbp: 100 }]
};

/** A tariff the source no longer publishes rates for. */
export const withdrawnTariff = {
  ...plain,
  id: 'acme-gone',
  name: 'Discontinued Saver',
  status: 'withdrawn',
  intro_period_months: null,
  rates: [],
  notes: 'Withdrawn by the supplier; no rates published.'
};
