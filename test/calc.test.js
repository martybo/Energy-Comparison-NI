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
  const intro = { ...fx.withShortIntro, id: 'intro-pp', reverts_to: 'dd-only', rates: [{ payment_method: 'prepayment', day_p_per_kwh: 10, night_p_per_kwh: 5, standing_p_per_day: 10 }] };
  const target = { ...fx.plain, id: 'dd-only', rates: [{ payment_method: 'direct_debit_ebill', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 }] };
  const res = compare(datasetOf(intro, target), { usage: USAGE, paymentMethod: 'prepayment' });
  assert.ok(res.warnings.some((w) => w.code === 'reversion_payment_method_differs'), 'the substitution is reported, not silent');
});

// --- usage-threshold discount caps ----------------------------------------

test('a discount cap does not bite when the year falls below the threshold', () => {
  const r = compare(datasetOf(fx.capStandard, fx.withUnreachedCap), { usage: USAGE }).results.find((x) => x.id === 'acme-uncapped');
  near(r.year1.total, 392.85, 'full discount retained');
  near(r.year1.capAdjustment, 0, 'no adjustment');
  assert.equal(r.discountCap.applied, false);
});

test('a discount cap charges the standard rate above the threshold', () => {
  const r = compare(datasetOf(fx.capStandard, fx.withDiscountCap), { usage: USAGE }).results.find((x) => x.id === 'acme-capped');
  near(r.year1.total, 416.5, 'capped year 1');
  near(r.year1.capAdjustment, 416.5 - 392.85, 'the cap adds back the uncapped portion');
  assert.equal(r.discountCap.applied, true);
  near(r.discountCap.standardCost, 436.5, 'standard cost computed from the referenced tariff');
  near(r.discountCap.savingGbp, 20, 'saving equals the discount on the threshold only');
});

test('a capped saving never exceeds the maximum the source states', () => {
  for (const kwh of [500, 1000, 3000, 10000, 100000]) {
    const usage = { annualDayKwh: kwh / 3, annualNightKwh: (kwh * 2) / 3 };
    const r = compare(datasetOf(fx.capStandard, fx.withDiscountCap), { usage }).results.find((x) => x.id === 'acme-capped');
    assert.ok(r.discountCap.savingGbp <= r.discountCap.maxSavingGbp + 1e-9, `at ${kwh} kWh the saving ${r.discountCap.savingGbp} exceeded the stated maximum ${r.discountCap.maxSavingGbp}`);
  }
});

test('a capped tariff is never cheaper than the same tariff uncapped', () => {
  const usage = { annualDayKwh: 5000, annualNightKwh: 10000 };
  const capped = compare(datasetOf(fx.capStandard, fx.withDiscountCap), { usage }).results.find((x) => x.id === 'acme-capped');
  const uncapped = compare(datasetOf(fx.capStandard, fx.withUnreachedCap), { usage }).results.find((x) => x.id === 'acme-uncapped');
  assert.ok(capped.year1.total > uncapped.year1.total, 'the cap must increase cost at high usage, never reduce it');
});

test('the cap also applies to the ongoing figure', () => {
  const r = compare(datasetOf(fx.capStandard, fx.withDiscountCap), { usage: USAGE }).results.find((x) => x.id === 'acme-capped');
  near(r.ongoing.total, 416.5, 'ongoing is capped too');
  near(r.ongoing.capAdjustment, 416.5 - 392.85, 'ongoing carries the same adjustment');
});

test('a capped tariff reconciles: schedule sums to the capped Year 1 total', () => {
  const r = compare(datasetOf(fx.capStandard, fx.withDiscountCap), { usage: USAGE }).results.find((x) => x.id === 'acme-capped');
  const sum = r.schedule.months.reduce((s, m) => s + m.total, 0);
  near(sum, r.year1.total, 'twelve months sum to the capped total');
});

// --- payment-method ties ---------------------------------------------------

test('a tie across every payment method is reported, not resolved arbitrarily', () => {
  const tie = { ...fx.plain, id: 'tie', rates: [
    { payment_method: 'prepayment', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 },
    { payment_method: 'on_receipt_postal', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 }
  ] };
  const r = compare(datasetOf(tie), { usage: USAGE }).results[0];
  assert.equal(r.paymentMethodTie, true);
  assert.equal(r.allPaymentMethodsTie, true);
  assert.deepEqual(r.tiedPaymentMethods, ['on_receipt_postal', 'prepayment']);
});

test('the named payment method no longer depends on the order of the rates array', () => {
  const rates = [
    { payment_method: 'prepayment', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 },
    { payment_method: 'direct_debit_ebill', day_p_per_kwh: 20, night_p_per_kwh: 10, standing_p_per_day: 10 }
  ];
  const forward = compare(datasetOf({ ...fx.plain, id: 't', rates }), { usage: USAGE }).results[0];
  const reverse = compare(datasetOf({ ...fx.plain, id: 't', rates: [...rates].reverse() }), { usage: USAGE }).results[0];
  assert.equal(forward.paymentMethod, reverse.paymentMethod, 'stable under reordering');
  assert.deepEqual(forward.tiedPaymentMethods, reverse.tiedPaymentMethods);
});

test('a genuine cheapest payment method is not reported as a tie', () => {
  const r = compare(datasetOf(fx.plain), { usage: USAGE }).results[0];
  assert.equal(r.paymentMethodTie, false);
  assert.equal(r.paymentMethod, 'direct_debit_ebill');
  assert.equal(r.alternativePaymentMethods[0].sameCost, false);
});

// --- withdrawn tariffs -----------------------------------------------------

test('a withdrawn tariff with no rates is kept as a record but never priced', () => {
  const res = compare(datasetOf(fx.plain, fx.withdrawnTariff), { usage: USAGE });
  assert.equal(res.results.length, 1);
  assert.ok(!res.results.some((r) => r.id === 'acme-gone'));
});

// --- the shipped 2026-09-12 dataset ----------------------------------------

const liveRaw = JSON.parse(readFileSync(new URL('../data/tariffs-2026-09-12.json', import.meta.url), 'utf8'));
const live = loadValidated(liveRaw);
const LIVE_USAGE = usageFromAnnualSplit(3200, 60);

test('the shipped dataset validates with no rejected records', () => {
  assert.equal(live.report.errors.length, 0, JSON.stringify(live.report.errors, null, 2));
  assert.equal(live.report.rejected.length, 0);
});

test('the shipped dataset matches the source date and VAT treatment', () => {
  assert.equal(live.report.dataset.effective_from, '2026-09-12');
  assert.equal(live.report.dataset.vat_treatment, 'inclusive');
  assert.equal(live.report.dataset.typical_annual_kwh, 3200);
  assert.ok(live.report.dataset.source_url.includes('consumercouncil.org.uk'));
});

test('the shipped dataset ranks Share Energy cheapest at the typical usage', () => {
  const res = compare(live.dataset, { usage: LIVE_USAGE });
  assert.equal(res.results[0].supplier, 'Share Energy');
  assert.ok(Math.abs(res.results[0].year1.total - 757.52) < 0.01, `got ${res.results[0].year1.total}`);
  assert.equal(res.results.length, 10);
  assert.equal(new Set(res.results.map((r) => r.id)).size, 10);
});

test('Power NI caps are inert at typical usage and bite at high usage', () => {
  const id = 'power-ni-monthly-direct-debit-with-online-billing-e7';
  const typical = compare(live.dataset, { usage: LIVE_USAGE, limit: 0 }).results.find((r) => r.id === id);
  assert.equal(typical.discountCap.applied, false, 'a 3,200 kWh year stays under the £1,000 threshold');
  assert.ok(Math.abs(typical.year1.total - 868.66) < 0.01, `got ${typical.year1.total}`);

  const heavy = compare(live.dataset, { usage: usageFromAnnualSplit(6000, 60), limit: 0 }).results.find((r) => r.id === id);
  assert.equal(heavy.discountCap.applied, true, 'a 6,000 kWh year exceeds the threshold');
  assert.ok(heavy.year1.capAdjustment > 0, 'the cap increases the cost');
  assert.ok(heavy.discountCap.savingGbp <= heavy.discountCap.maxSavingGbp + 1e-9, 'saving stays within the stated £60 maximum');
});

test('Power NI keypad carries no cap, as the source states', () => {
  const keypad = compare(live.dataset, { usage: usageFromAnnualSplit(6000, 60), limit: 0 }).results.find((r) => r.id === 'power-ni-keypad-e7');
  assert.equal(keypad.discountCap, null, 'the source exempts keypad customers from the threshold');
});

test('SSE fixed-term tariffs report a real ongoing cost and a step up', () => {
  const res = compare(live.dataset, { usage: LIVE_USAGE, limit: 0 }).results;
  const oneYear = res.filter((r) => r.introPeriodMonths === 12 && r.supplier === 'SSE Airtricity');
  assert.ok(oneYear.length >= 6, `expected several 1-year SSE tariffs, got ${oneYear.length}`);
  for (const r of oneYear) {
    assert.equal(r.ongoingKnown, true, `${r.id} should now have a known ongoing cost`);
    assert.ok(r.ongoing.total > r.year1.total, `${r.id} should step up after the introductory year`);
    assert.equal(r.ongoing.basis, 'reversion_rates');
  }
});

test('the cheapest Year 1 tariff is not the cheapest over two years', () => {
  const res = compare(live.dataset, { usage: LIVE_USAGE, limit: 0 }).results.filter((r) => r.ongoingKnown);
  const byYear1 = [...res].sort((a, b) => a.year1.total - b.year1.total)[0];
  const byTwoYear = [...res].sort((a, b) => (a.year1.total + a.ongoing.total) - (b.year1.total + b.ongoing.total))[0];
  assert.ok(byYear1.year1.total <= byTwoYear.year1.total);
  const sse = res.filter((r) => r.introPeriodMonths === 12).sort((a, b) => a.year1.total - b.year1.total)[0];
  assert.ok(sse.year1.total + sse.ongoing.total > byTwoYear.year1.total + byTwoYear.ongoing.total,
    'the best fixed-term deal costs more over two years than the best ongoing tariff');
});

test('welcome credits in the shipped dataset are data, not name strings', () => {
  const res = compare(live.dataset, { usage: LIVE_USAGE, limit: 0 }).results;
  const credited = res.filter((r) => r.credits.length > 0);
  assert.ok(credited.length >= 4, `expected several credited tariffs, got ${credited.length}`);
  const amounts = new Set(credited.flatMap((r) => r.credits.map((c) => c.amountGbp)));
  assert.deepEqual([...amounts].sort((a, b) => a - b), [30, 40, 60], 'the source states £30, £40 and £60 credits');
  for (const r of credited) {
    near(r.year1.total, r.year1.grossTotal - r.year1.creditsApplied, `${r.id} credit applied`);
  }
});

test('conditions the source states are recorded; those it omits stay unknown', () => {
  const res = compare(live.dataset, { usage: LIVE_USAGE, limit: 0 }).results;
  const sseFixed = res.find((r) => r.id === 'sse-airtricity-1-year-home-electricity-13-discount');
  assert.equal(sseFixed.conditions.exitFeeGbp, 40, 'the source states a £40 early exit fee');
  assert.equal(sseFixed.conditions.termMonths, 12);
  const powerNi = res.find((r) => r.id === 'power-ni-standard-rate-e7');
  assert.equal(powerNi.conditions.exitFeeGbp, 0, 'the source states "No exit fee"');
  assert.equal(powerNi.conditions.newCustomersOnly, false, 'the source states "new and existing customers"');
  const click = res.find((r) => r.id === 'click-energy-bill-pay-economy-7');
  assert.equal(click.conditions.exitFeeGbp, null, 'the source no longer states an exit fee for Click');
});

test('an exit fee is disclosed on the shipped data but never priced in', () => {
  const r = compare(live.dataset, { usage: LIVE_USAGE, limit: 0 }).results.find((x) => x.id === 'sse-airtricity-1-year-home-electricity-13-discount');
  const rate = liveRaw.tariffs.find((t) => t.id === r.id).rates[0];
  const energy = (rate.day_p_per_kwh * LIVE_USAGE.annualDayKwh + rate.night_p_per_kwh * LIVE_USAGE.annualNightKwh) / 100;
  near(r.year1.total, energy + (rate.standing_p_per_day * 365) / 100, 'the £40 exit fee is absent from the cost');
});

test('withdrawn Click tariffs are recorded but excluded from the comparison', () => {
  const withdrawn = liveRaw.tariffs.filter((t) => t.status === 'withdrawn');
  assert.equal(withdrawn.length, 2, 'both withdrawn Click Saver tariffs are kept as records');
  const res = compare(live.dataset, { usage: LIVE_USAGE, limit: 0 }).results;
  assert.ok(!res.some((r) => r.status === 'withdrawn'));
  assert.ok(!res.some((r) => withdrawn.map((w) => w.id).includes(r.id)));
});

test('no tariff name in the shipped dataset encodes an incentive', () => {
  for (const t of liveRaw.tariffs) {
    for (const adj of t.adjustments || []) {
      if (adj.type !== 'welcome_credit' && adj.type !== 'fixed_credit') continue;
      assert.ok(!new RegExp(`£\\s*${adj.amount_gbp}`).test(t.name) || t.adjustments.some((a) => a.amount_gbp === adj.amount_gbp),
        `${t.id}: a credit must be carried as data, not only in the name`);
      assert.equal(typeof adj.amount_gbp, 'number');
      assert.ok(adj.amount_gbp > 0);
    }
  }
});

test('the shipped dataset still needs no supplier names in the engine', () => {
  const src = readFileSync(new URL('../src/calc.js', import.meta.url), 'utf8');
  for (const name of ['Share Energy', 'SSE', 'Power NI', 'Budget', 'Click', 'Smartsaver', 'Keypad', 'Twilight']) {
    assert.ok(!src.includes(name), `calc.js must not reference "${name}"`);
  }
});

test('the shipped dataset does not claim an ongoing cost it cannot know', () => {
  const res = compare(live.dataset, { usage: LIVE_USAGE, limit: 0 }).results;
  for (const r of res) {
    if (!r.introPeriodKnown) {
      assert.equal(r.ongoingKnown, false, `${r.id} must not report an ongoing cost when its introductory period is unknown`);
    }
    if (r.ongoingKnown && r.introPeriodMonths > 0) {
      assert.ok(r.ongoing.revertsToId, `${r.id} must name the tariff it reverts to`);
    }
  }
  const promo = res.find((r) => r.id === 'budget-energy-keypad-promotional-1-economy-7');
  assert.equal(promo.ongoingKnown, false, 'a promotional discount of unstated duration has no knowable ongoing cost');
});
