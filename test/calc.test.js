import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compare, costFor, usageFromDaily, usageFromAnnualSplit, MONTHS_PER_YEAR } from '../src/calc.js';
import { loadValidated } from '../src/validate.js';
import * as fx from './fixtures.js';

const { USAGE, datasetOf } = fx;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: expected ${b}, got ${a}`);
const only = (t, opts = {}) => compare(datasetOf(t), { usage: USAGE, ...opts }).results[0];

// --- core cost model -------------------------------------------------------

test('normal day/night usage: energy plus standing charge', () => {
  const r = only(fx.plain);
  near(r.year1.energyCost, 400, 'energy');   // (20p*1000 + 10p*2000)/100
  near(r.year1.standingCost, 36.5, 'standing'); // 10p * 365 days
  near(r.year1.total, 436.5, 'year 1 total');
  near(r.year1.averageMonthly, 436.5 / 12, 'monthly average');
});

test('standing charge is isolated when usage is zero', () => {
  const r = compare(datasetOf(fx.plain), { usage: { annualDayKwh: 0, annualNightKwh: 0 } }).results[0];
  near(r.year1.energyCost, 0, 'no energy cost');
  near(r.year1.total, 36.5, 'standing charge only');
});

test('zero usage ranks purely on standing charge', () => {
  const cheap = { ...fx.plain, id: 'a', supplier: 'A Co', rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 99, night_p_per_kwh: 99, standing_p_per_day: 5 }] };
  const dear = { ...fx.plain, id: 'b', supplier: 'B Co', rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 1, night_p_per_kwh: 1, standing_p_per_day: 50 }] };
  const r = compare(datasetOf(dear, cheap), { usage: { annualDayKwh: 0, annualNightKwh: 0 } }).results;
  assert.equal(r[0].id, 'a');
});

test('very high usage stays finite and proportional', () => {
  const big = compare(datasetOf(fx.plain), { usage: { annualDayKwh: 1e6, annualNightKwh: 1e6 } }).results[0];
  assert.ok(Number.isFinite(big.year1.total));
  near(big.year1.total, (20 * 1e6 + 10 * 1e6) / 100 + 36.5, 'high usage total');
});

test('usage helpers convert daily and annual-split inputs', () => {
  const d = usageFromDaily(3.56, 5.33);
  near(d.annualDayKwh, 3.56 * 365, 'daily to annual day');
  const s = usageFromAnnualSplit(3200, 60);
  near(s.annualNightKwh, 1920, 'night share');
  near(s.annualDayKwh, 1280, 'day share');
});

// --- Year 1 incentive rules ------------------------------------------------

test('R-base: welcome credit is subtracted from the Year 1 total', () => {
  const r = only(fx.withCredit);
  near(r.year1.grossTotal, 436.5, 'gross before credit');
  near(r.year1.creditsApplied, 120, 'credit applied');
  near(r.year1.total, 316.5, 'year 1 net of credit');
  near(r.year1.averageMonthly, 316.5 / 12, 'monthly average includes credit');
});

test('a welcome credit can change the ranking', () => {
  const cheaperOnRates = { ...fx.plain, id: 'rival', supplier: 'Rival', name: 'Keen', rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 18, night_p_per_kwh: 9, standing_p_per_day: 10 }] };
  const ranked = compare(datasetOf(cheaperOnRates, fx.withCredit), { usage: USAGE }).results;
  assert.equal(ranked[0].id, 'acme-welcome', 'the credit tariff wins Year 1 despite higher unit rates');
  assert.ok(ranked[0].year1.total < ranked[1].year1.total);
});

test('credits can be excluded from ranking without mutating the dataset', () => {
  const withCredits = only(fx.withCredit);
  const without = only(fx.withCredit, { includeWelcomeCredits: false });
  near(withCredits.year1.total, 316.5, 'credit included');
  near(without.year1.total, 436.5, 'credit excluded');
  const again = only(fx.withCredit);
  near(again.year1.total, 316.5, 'dataset not mutated by a previous call');
});

test('R4: a credit larger than the bill is reported, not clamped', () => {
  const r = compare(datasetOf(fx.withCredit), { usage: { annualDayKwh: 0, annualNightKwh: 0 } }).results[0];
  near(r.year1.total, 36.5 - 120, 'negative total preserved');
  assert.equal(r.year1.creditExceedsCost, true);
});

test('R3: an exit fee is disclosed but never added to the cost', () => {
  const r = compare(datasetOf(fx.plain, fx.withShortIntro), { usage: USAGE }).results.find((x) => x.id === 'acme-six-month');
  assert.equal(r.conditions.exitFeeGbp, 50);
  near(r.year1.total, 336.5, 'exit fee excluded from Year 1');
});

// --- ongoing cost ----------------------------------------------------------

test('R1: ongoing cost is unknown when the discount duration is unstated', () => {
  const r = only(fx.withUnknownIntro);
  near(r.year1.total, 316.5, 'year 1 still priced');
  assert.equal(r.ongoingKnown, false);
  assert.equal(r.ongoing, null, 'no fabricated ongoing figure');
  assert.equal(r.introPeriodKnown, false);
});

test('ongoing equals Year 1 when there is no introductory period', () => {
  const r = only(fx.plain);
  assert.equal(r.ongoingKnown, true);
  near(r.ongoing.total, 436.5, 'ongoing matches year 1');
  assert.equal(r.ongoing.basis, 'same_rates');
});

test('R2: a short introductory period blends both rates across Year 1', () => {
  const r = compare(datasetOf(fx.plain, fx.withShortIntro), { usage: USAGE }).results.find((x) => x.id === 'acme-six-month');
  // 6 months at 236.50/yr + 6 months at 436.50/yr
  near(r.year1.total, 236.5 / 2 + 436.5 / 2, 'blended year 1');
  assert.equal(r.year1.blendedWithReversion, true);
  near(r.ongoing.total, 436.5, 'ongoing uses the reversion tariff');
  assert.equal(r.ongoing.basis, 'reversion_rates');
  assert.equal(r.ongoing.revertsToId, 'acme-basic');
});

test('a 12-month introductory rate prices Year 1 at the intro rate and ongoing at the reversion rate', () => {
  const r = compare(datasetOf(fx.plain, fx.withCalculatedDiscount), { usage: USAGE }).results.find((x) => x.id === 'acme-calc-discount');
  near(r.year1.total, 336.5, 'year 1 at the discounted rate');
  near(r.ongoing.total, 436.5, 'ongoing at the standard rate');
  assert.ok(r.ongoing.total > r.year1.total, 'the cliff after year one is visible');
});

test('an unresolvable reversion is flagged and never silently guessed', () => {
  const res = compare(datasetOf(fx.withUnknownReversion), { usage: USAGE });
  const r = res.results[0];
  assert.equal(r.year1.complete, false);
  assert.equal(r.ongoingKnown, false);
  assert.ok(res.warnings.some((w) => w.code === 'reversion_unknown'));
});

test('a reverts_to pointing at a missing tariff raises a warning', () => {
  const broken = { ...fx.withShortIntro, id: 'broken', reverts_to: 'does-not-exist' };
  const res = compare(datasetOf(broken), { usage: USAGE });
  assert.ok(res.warnings.some((w) => w.code === 'reverts_to_missing'));
  assert.equal(res.results[0].ongoingKnown, false);
});

// --- discount taxonomy (R6) ------------------------------------------------

test('a percentage discount is calculated when rates are the standard rates', () => {
  const r = compare(datasetOf(fx.plain, fx.withCalculatedDiscount), { usage: USAGE }).results.find((x) => x.id === 'acme-calc-discount');
  near(r.rates.dayPPerKwh, 15, '25% off 20p');
  near(r.rates.nightPPerKwh, 7.5, '25% off 10p');
});

test('R6: a discount already in the published rate is never applied twice', () => {
  const r = only(fx.withBakedInDiscount);
  near(r.rates.dayPPerKwh, 15, 'published rate used as-is');
  near(r.year1.total, 336.5, 'no second discount');
});

test('baked-in and calculated discounts produce identical costs', () => {
  const calculated = compare(datasetOf(fx.plain, fx.withCalculatedDiscount), { usage: USAGE }).results.find((x) => x.id === 'acme-calc-discount');
  const baked = only(fx.withBakedInDiscount);
  near(calculated.year1.total, baked.year1.total, 'two encodings, one answer');
});

test('R6: the engine refuses a percentage discount on an already-discounted rate', () => {
  const unsafe = { ...fx.withBakedInDiscount, id: 'unsafe', adjustments: [{ type: 'percentage_discount', pct: 25, applies: 'first_year', applies_to: 'all' }] };
  const r = only(unsafe);
  near(r.rates.dayPPerKwh, 15, 'discount not re-applied even on an unvalidated dataset');
});

test('R5: a recurring credit spreads and continues beyond Year 1', () => {
  const r = only(fx.withRecurringCredit);
  near(r.year1.total, 436.5 - 60, 'twelve monthly credits');
  near(r.ongoing.total, 436.5 - 60, 'recurring credit continues');
  assert.equal(r.credits[0].spreadable, true);
});

// --- billing-period timing -------------------------------------------------

test('an unspecified welcome credit is never spread across the months', () => {
  const r = only(fx.withCredit);
  const monthly = r.schedule.months;
  assert.ok(monthly.every((m) => m.credits === 0), 'no month claims a share of the credit');
  near(r.schedule.unplacedCreditsGbp, 120, 'credit reported as unplaced');
  const sum = monthly.reduce((s, m) => s + m.total, 0);
  near(sum, r.year1.grossTotal, 'monthly schedule sums to the gross, credit held outside it');
});

test('a credit with stated timing lands in that billing period only', () => {
  const r = only(fx.withTimedCredit);
  const m = r.schedule.months;
  near(m[0].credits, 120, 'credit in month 1');
  assert.ok(m.slice(1).every((x) => x.credits === 0), 'no other month credited');
  near(r.schedule.unplacedCreditsGbp, 0, 'nothing left unplaced');
  const sum = m.reduce((s, x) => s + x.total, 0);
  near(sum, r.year1.total, 'schedule reconciles to the Year 1 net total');
});

test('a recurring credit does appear in every month', () => {
  const r = only(fx.withRecurringCredit);
  assert.ok(r.schedule.months.every((m) => Math.abs(m.credits - 5) < 1e-9));
  near(r.schedule.unplacedCreditsGbp, 0, 'nothing unplaced');
});

test('the schedule always covers twelve months', () => {
  assert.equal(only(fx.plain).schedule.months.length, MONTHS_PER_YEAR);
});

// --- ranking ---------------------------------------------------------------

test('results are ranked by Year 1 total, cheapest first', () => {
  const mk = (id, day) => ({ ...fx.plain, id, supplier: `S${id}`, rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: day, night_p_per_kwh: 10, standing_p_per_day: 10 }] });
  const r = compare(datasetOf(mk('c', 30), mk('a', 10), mk('b', 20)), { usage: USAGE }).results;
  assert.deepEqual(r.map((x) => x.id), ['a', 'b', 'c']);
});

test('R7: ranking uses full precision, not the rounded display value', () => {
  const a = { ...fx.plain, id: 'a', supplier: 'A Co', rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 }] };
  const b = { ...fx.plain, id: 'b', supplier: 'B Co', rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 20.0003, night_p_per_kwh: 10, standing_p_per_day: 10 }] };
  const r = compare(datasetOf(b, a), { usage: USAGE }).results;
  assert.equal(r[0].id, 'a', 'sub-penny difference still orders correctly');
  assert.equal(r[0].year1.total.toFixed(2), r[1].year1.total.toFixed(2), 'and they display identically');
});

test('ties break deterministically rather than by file order', () => {
  const a = { ...fx.plain, id: 'a', supplier: 'Alpha', name: 'One' };
  const b = { ...fx.plain, id: 'b', supplier: 'Beta', name: 'One' };
  const forward = compare(datasetOf(a, b), { usage: USAGE }).results.map((x) => x.id);
  const reverse = compare(datasetOf(b, a), { usage: USAGE }).results.map((x) => x.id);
  assert.deepEqual(forward, reverse, 'order does not depend on position in the data file');
  assert.deepEqual(forward, ['a', 'b']);
});

test('the top 10 is capped and contains ten distinct products', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...fx.plain, id: `t${i}`, supplier: `Supplier ${i}`, rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 10 + i, night_p_per_kwh: 10, standing_p_per_day: 10 }] }));
  const res = compare(datasetOf(...many), { usage: USAGE });
  assert.equal(res.results.length, 10);
  assert.equal(new Set(res.results.map((r) => r.id)).size, 10, 'no duplicated products');
  assert.equal(res.totalConsidered, 25);
});

test('several tariffs from one supplier may occupy the top 10', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ ...fx.plain, id: `acme${i}`, supplier: 'Acme Power', name: `Plan ${i}`, rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 10 + i, night_p_per_kwh: 10, standing_p_per_day: 10 }] }));
  const r = compare(datasetOf(...many), { usage: USAGE }).results;
  assert.equal(r.length, 10);
  assert.ok(r.every((x) => x.supplier === 'Acme Power'), 'no supplier diversity quota is imposed');
});

test('one product per tariff: payment-method variants do not fill the list', () => {
  const res = compare(datasetOf(fx.plain), { usage: USAGE });
  assert.equal(res.results.length, 1, 'two payment methods, one product');
  const r = res.results[0];
  assert.equal(r.paymentMethod, 'direct_debit_ebill', 'cheapest method chosen');
  assert.equal(r.alternativePaymentMethods.length, 1);
  assert.equal(r.alternativePaymentMethods[0].paymentMethod, 'prepayment');
});

// --- payment-method filtering ----------------------------------------------

test('filtering by payment method prices that method', () => {
  const r = compare(datasetOf(fx.plain), { usage: USAGE, paymentMethod: 'prepayment' }).results[0];
  near(r.year1.total, 400 + (20 * 365) / 100, 'prepayment standing charge used');
  assert.equal(r.paymentMethod, 'prepayment');
});

test('a tariff not sold on the filtered method is excluded', () => {
  const res = compare(datasetOf(fx.withBakedInDiscount), { usage: USAGE, paymentMethod: 'prepayment' });
  assert.equal(res.results.length, 0, 'not offered on that method, so not shown');
});

test('no filter considers every eligible tariff', () => {
  const res = compare(datasetOf(fx.plain, fx.withBakedInDiscount), { usage: USAGE, paymentMethod: null });
  assert.equal(res.totalConsidered, 2);
});

test('withdrawn tariffs are excluded unless explicitly requested', () => {
  const gone = { ...fx.plain, id: 'gone', status: 'withdrawn' };
  assert.equal(compare(datasetOf(gone), { usage: USAGE }).results.length, 0);
  assert.equal(compare(datasetOf(gone), { usage: USAGE, includeWithdrawn: true }).results.length, 1);
});

// --- input handling --------------------------------------------------------

test('invalid usage is refused rather than costed', () => {
  for (const bad of [undefined, {}, { annualDayKwh: NaN, annualNightKwh: 10 }, { annualDayKwh: 10, annualNightKwh: undefined }, { annualDayKwh: '10', annualNightKwh: 10 }, { annualDayKwh: Infinity, annualNightKwh: 0 }]) {
    assert.throws(() => compare(datasetOf(fx.plain), { usage: bad }), TypeError, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('negative usage is refused rather than producing a negative bill', () => {
  assert.throws(() => compare(datasetOf(fx.plain), { usage: { annualDayKwh: -100, annualNightKwh: 10 } }), RangeError);
});

test('an empty dataset returns no results rather than throwing', () => {
  const res = compare(datasetOf(), { usage: USAGE });
  assert.deepEqual(res.results, []);
  assert.equal(res.totalConsidered, 0);
});

test('a tariff with no rate rows is skipped', () => {
  const empty = { ...fx.plain, id: 'empty', rates: [] };
  assert.equal(compare(datasetOf(empty), { usage: USAGE }).results.length, 0);
});

// --- data-driven architecture ----------------------------------------------

test('an unknown supplier name needs no code change', () => {
  const novel = { ...fx.plain, id: 'novel-co-plan', supplier: 'Completely New Energy Ltd', name: 'Night Owl 2099' };
  const r = only(novel);
  assert.equal(r.supplier, 'Completely New Energy Ltd');
  assert.equal(r.name, 'Night Owl 2099');
  near(r.year1.total, 436.5, 'priced by the same rules as any other tariff');
});

test('no supplier or tariff name appears in the engine source', () => {
  const src = readFileSync(new URL('../src/calc.js', import.meta.url), 'utf8');
  for (const name of ['SSE', 'Airtricity', 'Power NI', 'Budget Energy', 'Click Energy', 'Electric Ireland', 'Share Energy', 'Economy 7', 'Smartsaver', 'Keypad']) {
    assert.ok(!src.includes(name), `calc.js must not reference "${name}"`);
  }
});

// --- the real dataset ------------------------------------------------------

const realRaw = JSON.parse(readFileSync(new URL('../data/tariffs-2025-08.json', import.meta.url), 'utf8'));
const real = loadValidated(realRaw);

test('the shipped dataset validates with no rejected records', () => {
  assert.equal(real.report.errors.length, 0, JSON.stringify(real.report.errors, null, 2));
  assert.equal(real.report.rejected.length, 0);
  assert.ok(real.report.valid.length > 0);
});

test('the shipped dataset produces ten distinct products in the top 10', () => {
  const res = compare(real.dataset, { usage: usageFromAnnualSplit(3200, 60) });
  assert.equal(res.results.length, 10);
  assert.equal(new Set(res.results.map((r) => r.id)).size, 10);
  const keys = res.results.map((r) => `${r.supplier}|${r.name}`);
  assert.equal(new Set(keys).size, 10, 'no product repeated under a different payment method');
});

test('the shipped dataset carries its welcome credits as data, not as names', () => {
  const res = compare(real.dataset, { usage: usageFromAnnualSplit(3200, 60), limit: 0 });
  const credited = res.results.filter((r) => r.credits.length > 0);
  assert.ok(credited.length >= 1, 'welcome credits survived migration');
  for (const r of credited) {
    assert.ok(!/£|credit/i.test(r.name), `tariff name "${r.name}" still encodes an incentive`);
    assert.ok(r.credits.every((c) => typeof c.amountGbp === 'number' && c.amountGbp > 0));
  }
});

test('the shipped dataset does not claim an ongoing cost it cannot know', () => {
  const res = compare(real.dataset, { usage: usageFromAnnualSplit(3200, 60), limit: 0 });
  for (const r of res.results) {
    if (r.headlineDiscountPct != null && !r.introPeriodKnown) {
      assert.equal(r.ongoingKnown, false, `${r.id} must not report an ongoing cost`);
    }
  }
});

// --- schedule reflects the real rate pattern, not a flat average -----------

test('a blended Year 1 shows the step up in the month the intro rate ends', () => {
  const r = compare(datasetOf(fx.plain, fx.withShortIntro), { usage: USAGE }).results.find((x) => x.id === 'acme-six-month');
  const m = r.schedule.months;
  near(m[0].total, 236.5 / 12, 'month 1 at the introductory rate');
  near(m[5].total, 236.5 / 12, 'month 6 still at the introductory rate');
  near(m[6].total, 436.5 / 12, 'month 7 at the reversion rate');
  near(m[11].total, 436.5 / 12, 'month 12 at the reversion rate');
  assert.ok(m[6].total > m[5].total, 'the cliff is visible in the timeline');
  const sum = m.reduce((s, x) => s + x.total, 0);
  near(sum, r.year1.total, 'the twelve months still sum to the Year 1 total');
});

test('a tariff with no introductory period has a flat schedule', () => {
  const m = only(fx.plain).schedule.months;
  assert.ok(m.every((x) => Math.abs(x.total - 436.5 / 12) < 1e-9));
});

test('excluding welcome credits also removes them from the schedule', () => {
  const r = only(fx.withTimedCredit, { includeWelcomeCredits: false });
  assert.ok(r.schedule.months.every((m) => m.credits === 0), 'no month retains the excluded credit');
  near(r.schedule.unplacedCreditsGbp, 0, 'nothing left unplaced');
  const sum = r.schedule.months.reduce((s, m) => s + m.total, 0);
  near(sum, r.year1.total, 'schedule reconciles to the credit-free total');
  assert.equal(r.credits.length, 0);
});

test('a reversion tariff not sold on the same payment method is flagged', () => {
  // withShortIntro is direct-debit only; price it on prepayment via a reverting
  // tariff whose prepayment rate does not exist.
  const intro = { ...fx.withShortIntro, id: 'intro-pp', reverts_to: 'dd-only', rates: [{ payment_method: 'prepayment', day_p_per_kwh: 10, night_p_per_kwh: 5, standing_p_per_day: 10 }] };
  const target = { ...fx.plain, id: 'dd-only', rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 }] };
  const res = compare(datasetOf(intro, target), { usage: USAGE, paymentMethod: 'prepayment' });
  assert.ok(res.warnings.some((w) => w.code === 'reversion_payment_method_differs'), 'the substitution is reported, not silent');
});
