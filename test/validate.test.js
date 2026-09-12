import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset, loadValidated } from '../src/validate.js';
import { datasetStatus, gbp, year1Monthly } from '../src/format.js';
import * as fx from './fixtures.js';

const { datasetOf } = fx;
const codes = (r) => r.errors.map((e) => e.code);
const check = (patch) => validateDataset(datasetOf({ ...fx.plain, ...patch }));

test('a well-formed dataset passes', () => {
  const r = validateDataset(datasetOf(fx.plain, fx.withCredit));
  assert.equal(r.errors.length, 0);
  assert.equal(r.valid.length, 2);
});

test('a missing supplier is rejected', () => {
  assert.ok(codes(check({ supplier: '' })).includes('supplier_missing'));
  assert.ok(codes(check({ supplier: undefined })).includes('supplier_missing'));
});

test('a missing tariff name is rejected', () => {
  assert.ok(codes(check({ name: undefined })).includes('name_missing'));
});

test('a missing or unrecognised payment method is rejected', () => {
  const r = check({ rates: [{ payment_method: 'carrier_pigeon', day_p_per_kwh: 1, night_p_per_kwh: 1, standing_p_per_day: 1 }] });
  assert.ok(codes(r).includes('payment_method_invalid'));
  const missing = check({ rates: [{ day_p_per_kwh: 1, night_p_per_kwh: 1, standing_p_per_day: 1 }] });
  assert.ok(codes(missing).includes('payment_method_invalid'));
});

test('a duplicated payment method on one tariff is rejected', () => {
  const dup = check({ rates: [
    { payment_method: 'prepayment', day_p_per_kwh: 1, night_p_per_kwh: 1, standing_p_per_day: 1 },
    { payment_method: 'prepayment', day_p_per_kwh: 2, night_p_per_kwh: 2, standing_p_per_day: 2 }
  ] });
  assert.ok(codes(dup).includes('payment_method_duplicate'));
});

test('negative rates are rejected', () => {
  for (const field of ['day_p_per_kwh', 'night_p_per_kwh', 'standing_p_per_day']) {
    const r = check({ rates: [{ payment_method: 'prepayment', day_p_per_kwh: 1, night_p_per_kwh: 1, standing_p_per_day: 1, [field]: -1 }] });
    assert.ok(codes(r).includes('rate_field_negative'), `${field} must not accept a negative value`);
  }
});

test('a missing day or night rate is rejected', () => {
  const noDay = check({ rates: [{ payment_method: 'prepayment', night_p_per_kwh: 1, standing_p_per_day: 1 }] });
  assert.ok(codes(noDay).includes('rate_field_missing'));
  const noNight = check({ rates: [{ payment_method: 'prepayment', day_p_per_kwh: 1, standing_p_per_day: 1 }] });
  assert.ok(codes(noNight).includes('rate_field_missing'));
});

test('a missing standing charge is rejected but a zero standing charge is valid', () => {
  const missing = check({ rates: [{ payment_method: 'prepayment', day_p_per_kwh: 1, night_p_per_kwh: 1 }] });
  assert.ok(codes(missing).includes('rate_field_missing'));
  const zero = check({ rates: [{ payment_method: 'prepayment', day_p_per_kwh: 1, night_p_per_kwh: 1, standing_p_per_day: 0 }] });
  assert.equal(zero.errors.length, 0, 'a genuine zero is data, not an error');
  assert.equal(zero.valid.length, 1);
});

test('a valid zero is distinguished from null, NaN and a numeric string', () => {
  const asString = check({ rates: [{ payment_method: 'prepayment', day_p_per_kwh: '30.179', night_p_per_kwh: 1, standing_p_per_day: 1 }] });
  assert.ok(codes(asString).includes('rate_field_not_numeric'), 'a numeric string is malformed, not a number');
  const asNaN = check({ rates: [{ payment_method: 'prepayment', day_p_per_kwh: NaN, night_p_per_kwh: 1, standing_p_per_day: 1 }] });
  assert.ok(codes(asNaN).includes('rate_field_not_numeric'));
  const asNull = check({ rates: [{ payment_method: 'prepayment', day_p_per_kwh: null, night_p_per_kwh: 1, standing_p_per_day: 1 }] });
  assert.ok(codes(asNull).includes('rate_field_missing'));
});

test('a tariff with no rates at all is rejected', () => {
  assert.ok(codes(check({ rates: [] })).includes('rates_missing'));
  assert.ok(codes(check({ rates: undefined })).includes('rates_missing'));
});

test('a malformed effective date is rejected', () => {
  for (const bad of ['01/08/2025', '2025-13-01', '2025-02-30', 'August 2025', null, undefined]) {
    const ds = datasetOf(fx.plain);
    ds.dataset.effective_from = bad;
    assert.ok(validateDataset(ds).errors.some((e) => e.code === 'effective_from_invalid'), `should reject ${bad}`);
  }
});

test('duplicate tariff ids are rejected', () => {
  const r = validateDataset(datasetOf(fx.plain, { ...fx.plain, name: 'Copy' }));
  assert.ok(codes(r).includes('id_duplicate'));
});

test('R6: a percentage discount on an already-discounted rate is an error, not a silent skip', () => {
  const r = validateDataset(datasetOf({
    ...fx.withBakedInDiscount,
    adjustments: [{ type: 'percentage_discount', pct: 25, applies: 'first_year', applies_to: 'all' }]
  }));
  assert.ok(codes(r).includes('discount_double_application'));
  assert.equal(r.valid.length, 0, 'the record is excluded rather than mis-costed');
});

test('a percentage discount on standard rates is accepted', () => {
  const r = validateDataset(datasetOf(fx.withCalculatedDiscount));
  assert.equal(r.errors.length, 0);
});

test('an out-of-range discount percentage is rejected', () => {
  for (const pct of [-5, 150, 'twenty', null]) {
    const r = validateDataset(datasetOf({ ...fx.withCalculatedDiscount, adjustments: [{ type: 'percentage_discount', pct, applies: 'first_year' }] }));
    assert.ok(codes(r).includes('discount_pct_invalid'), `should reject pct ${pct}`);
  }
});

test('an unrecognised adjustment type is rejected', () => {
  const r = validateDataset(datasetOf({ ...fx.plain, adjustments: [{ type: 'free_toaster', amount_gbp: 10 }] }));
  assert.ok(codes(r).includes('adjustment_type_invalid'));
});

test('a negative or non-numeric credit amount is rejected', () => {
  for (const amount of [-10, '130', null, NaN]) {
    const r = validateDataset(datasetOf({ ...fx.plain, adjustments: [{ type: 'welcome_credit', amount_gbp: amount, applies: 'first_year' }] }));
    assert.ok(codes(r).includes('adjustment_amount_invalid'), `should reject ${amount}`);
  }
});

test('a credit timing outside the twelve-month year is rejected', () => {
  for (const month of [0, 13, 1.5, 'first']) {
    const r = validateDataset(datasetOf({ ...fx.plain, adjustments: [{ type: 'welcome_credit', amount_gbp: 100, applies: 'first_year', timing: { month } }] }));
    assert.ok(codes(r).includes('credit_timing_invalid'), `should reject month ${month}`);
  }
});

test('a recurring credit must declare its frequency', () => {
  const r = validateDataset(datasetOf({ ...fx.plain, adjustments: [{ type: 'recurring_credit', amount_gbp: 5, applies: 'ongoing' }] }));
  assert.ok(codes(r).includes('frequency_invalid'));
});

test('an unknown intro period is a warning, not an error', () => {
  const r = validateDataset(datasetOf(fx.withUnknownIntro));
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.code === 'ongoing_cost_unknown'));
});

test('an invalid intro period is an error', () => {
  assert.ok(codes(check({ intro_period_months: -3 })).includes('intro_period_invalid'));
  assert.ok(codes(check({ intro_period_months: 'twelve' })).includes('intro_period_invalid'));
});

test('an unknown exit fee is allowed but a negative one is not', () => {
  assert.equal(check({ contract: { type: 'unknown', term_months: null, exit_fee_gbp: null } }).errors.length, 0);
  assert.ok(codes(check({ contract: { type: 'fixed', term_months: 12, exit_fee_gbp: -50 } })).includes('exit_fee_invalid'));
});

test('unstated VAT treatment raises a warning so totals are not mislabelled', () => {
  const ds = datasetOf(fx.plain);
  ds.dataset.vat_treatment = 'unknown';
  assert.ok(validateDataset(ds).warnings.some((w) => w.code === 'vat_unknown'));
});

test('loadValidated returns only the records safe to cost', () => {
  const broken = { ...fx.plain, id: 'broken', rates: [{ payment_method: 'prepayment', day_p_per_kwh: null, night_p_per_kwh: 1, standing_p_per_day: 1 }] };
  const { dataset, report } = loadValidated(datasetOf(fx.plain, broken));
  assert.equal(dataset.tariffs.length, 1);
  assert.equal(dataset.tariffs[0].id, 'acme-basic');
  assert.equal(report.rejected.length, 1);
  assert.equal(report.rejected[0].where, 'broken');
});

test('a missing dataset is handled rather than thrown', () => {
  for (const bad of [null, undefined, 'nonsense', 42]) {
    const r = validateDataset(bad);
    assert.ok(r.errors.some((e) => e.code === 'dataset_missing'), `should handle ${bad}`);
    assert.deepEqual(r.valid, []);
  }
});

// --- display rules ---------------------------------------------------------

test('stale data is announced as stale', () => {
  const fresh = datasetStatus({ effective_from: '2026-09-01' }, new Date('2026-09-12T00:00:00Z'));
  assert.equal(fresh.level, 'ok');
  const stale = datasetStatus({ effective_from: '2025-08-01' }, new Date('2026-09-12T00:00:00Z'));
  assert.equal(stale.level, 'error');
  assert.match(stale.message, /out of date/);
  assert.equal(datasetStatus({}, new Date()).level, 'error');
});

test('R7: the monthly average is derived from full precision and need not reconcile', () => {
  const result = { year1: { total: 316.5, averageMonthly: 316.5 / 12 } };
  assert.equal(year1Monthly(result), '£26.38/month average in Year 1');
  assert.equal(gbp(316.5), '£316.50');
  assert.notEqual((26.38 * 12).toFixed(2), '316.50', 'displayed figures are each rounded from full precision');
});

test('a negative total renders with a minus sign rather than as nonsense', () => {
  assert.equal(gbp(-83.5), '−£83.50');
  assert.equal(gbp(NaN), '—');
  assert.equal(gbp(undefined), '—');
});
