import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assembleTable } from '../scripts/extract/table.mjs';
import { mapToCanonical, canonicalId, MappingError, FIELD_PROVENANCE, TIER_2_FIELDS } from '../scripts/extract/map-canonical.mjs';
import { validateDataset } from '../src/validate.js';

/**
 * The mapping layer is tested against the real captured text layers and the
 * hand-audited 2026-09-12 datasets. Those datasets are a golden comparison,
 * not the specification: where the candidate differs, the test states which
 * reading of the source it is pinning and why, rather than asserting the
 * previous JSON is correct by definition.
 */

const fixture = (family) => JSON.parse(readFileSync(`test/fixtures/consumer-council/${family}-text-items.json`, 'utf8'));
const published = (file) => JSON.parse(readFileSync(`data/${file}`, 'utf8'));

const run = (family, file) =>
  mapToCanonical({
    table: assembleTable(fixture(family), family),
    previous: { dataset: published(file), label: `data/${file}` }
  });

const economy7 = run('economy7', 'tariffs-2026-09-12.json');
const standard = run('standard', 'tariffs-standard-2026-09-12.json');

// --- the candidate is a valid dataset by the application's own rules --------

test('both candidate datasets pass src/validate.js with no rejected records', () => {
  for (const [family, result] of [['economy7', economy7], ['standard', standard]]) {
    const { invalid } = validateDataset(result.dataset);
    assert.deepEqual(invalid ?? [], [], `${family} produced records the validator rejects`);
  }
});

// --- Economy 7 reproduces the human audit from the PDF alone ---------------

test('the Economy 7 candidate reproduces the audited totals', () => {
  // docs/RECONCILIATION-2026-09-12.md: 30 priced rows, 42 payment-method
  // slots, 29 products, 5 suppliers.
  assert.equal(economy7.totals.source_rows, 30);
  assert.equal(economy7.totals.payment_method_slots, 42);
  assert.equal(economy7.totals.products, 29);
  assert.equal(economy7.totals.rate_rows, 42);
});

test('the Economy 7 candidate carries every published product id, and invents none', () => {
  const before = new Set(published('tariffs-2026-09-12.json').tariffs.map((t) => t.id));
  const after = new Set(economy7.dataset.tariffs.map((t) => t.id));
  assert.deepEqual([...after].filter((id) => !before.has(id)), []);
  assert.deepEqual([...before].filter((id) => !after.has(id)), []);
});

test('every Economy 7 rate matches the published dataset, to the printed precision', () => {
  // The strongest check available offline: 42 slots transcribed by hand and 42
  // read from the PDF agree exactly. A rate difference here means either the
  // source changed or the reader is wrong, and must be investigated, not
  // absorbed by relaxing the test.
  const before = new Map(published('tariffs-2026-09-12.json').tariffs.map((t) => [t.id, t]));
  const differences = [];
  for (const tariff of economy7.dataset.tariffs) {
    for (const rate of tariff.rates) {
      const prior = before.get(tariff.id).rates.find((r) => r.payment_method === rate.payment_method);
      if (!prior) differences.push(`${tariff.id}/${rate.payment_method} is new`);
      else {
        for (const field of ['day_p_per_kwh', 'night_p_per_kwh', 'standing_p_per_day']) {
          if (rate[field] !== prior[field]) differences.push(`${tariff.id}/${rate.payment_method}.${field}: ${prior[field]} -> ${rate[field]}`);
        }
      }
    }
  }
  assert.deepEqual(differences, []);
});

test('the Economy 7 candidate needs no human decision', () => {
  assert.deepEqual(economy7.review_required, []);
});

// --- carry-forward is bounded, tagged and audited --------------------------

test('only Tier 2 fields are ever carried forward', () => {
  for (const result of [economy7, standard]) {
    for (const entry of result.carry_forward_audit) {
      assert.ok(
        [...TIER_2_FIELDS, 'withdrawn_product_terms'].includes(entry.field),
        `${entry.field} was carried forward but is not a Tier 2 field`
      );
    }
  }
});

test('every carried value names the dataset, product and reason it came from', () => {
  for (const result of [economy7, standard]) {
    for (const entry of result.carry_forward_audit) {
      assert.equal(typeof entry.previous_dataset, 'string');
      assert.equal(typeof entry.previous_product_id, 'string');
      assert.ok(entry.eligible_because.length > 20, 'the reason must say why, not just that');
      assert.equal(typeof entry.source_contradicts, 'boolean');
    }
  }
});

test('carry-forward is bounded to the products that actually need domain knowledge', () => {
  // Economy 7: Power NI's five capped-discount tariffs and SSE's eight
  // fixed-term tariffs. Nothing else in the table needs a value the source
  // does not state, so a jump here means something started being inherited.
  const byField = {};
  for (const entry of economy7.carry_forward_audit) byField[entry.field] = (byField[entry.field] ?? 0) + 1;
  assert.equal(byField.discount_cap, 5);
  assert.equal(byField.reverts_to, 8);
});

test('a carried field is tagged carried_forward and a source-stated one is not', () => {
  const sse = economy7.field_provenance['sse-airtricity-1-year-home-electricity-13-discount'];
  assert.equal(sse.reverts_to, FIELD_PROVENANCE.CARRIED_FORWARD);
  assert.equal(sse.rates, FIELD_PROVENANCE.SOURCE_DERIVED);
  assert.equal(sse.headline_discount_pct, FIELD_PROVENANCE.SOURCE_DERIVED);
});

// --- Tier 2 is never inferred for a product whose identity is not established

test('a new product never inherits a Tier 2 value from a similar one', () => {
  // SSE prints "1 Year Home Keypad 10.5% discount plus £30 welcome credit
  // (24hr)"; the published dataset calls the same slot "1 Year Keypad ...".
  // Eight other SSE fixed-term tariffs revert to the same standard tariff, so
  // guessing would be easy and wrong: identity is not established, so the
  // value is withheld and raised for a person.
  const review = standard.review_required.find(
    (item) => item.field === 'reverts_to' && item.product_id.includes('1-year-home-keypad')
  );
  assert.ok(review, 'the renamed SSE keypad tariff must raise a review item');
  assert.equal(review.reason, 'tier2_missing_for_new_product');
  const tariff = standard.dataset.tariffs.find((t) => t.id === review.product_id);
  assert.equal(tariff.reverts_to, null, 'reverts_to must stay unknown rather than be inferred');
  assert.equal(standard.field_provenance[review.product_id].reverts_to, FIELD_PROVENANCE.NEEDS_REVIEW);
});

test('a carried value the previous dataset held is never dropped in silence', () => {
  // Power NI's capped discount, with the signal removed from the source. The
  // cap must not vanish just because the wording stopped matching.
  const table = assembleTable(fixture('economy7'), 'economy7');
  for (const row of table.rows) {
    row.additional_information = row.additional_information.replace(/maximum[^.]*per year\./i, '');
  }
  const result = mapToCanonical({
    table,
    previous: { dataset: published('tariffs-2026-09-12.json'), label: 'data/tariffs-2026-09-12.json' }
  });
  const lost = result.review_required.filter((item) => item.reason === 'carried_value_lost' && item.field === 'discount_cap');
  assert.equal(lost.length, 5, 'each capped Power NI tariff must raise the loss, not lose the cap');
  for (const item of lost) {
    const tariff = result.dataset.tariffs.find((t) => t.id === item.product_id);
    assert.ok(!tariff.adjustments.some((a) => a.type === 'discount_cap'), 'the old cap must not be retained unverified');
    assert.ok(item.previous_value, 'the review item must show what would have been lost');
  }
});

test('a source that contradicts a carried cap fails rather than keeping the old value', () => {
  const table = assembleTable(fixture('economy7'), 'economy7');
  const row = table.rows.find((r) => /Maximum of £60 savings per year/i.test(r.additional_information));
  assert.ok(row, 'expected Power NI to state a £60 maximum saving');
  row.additional_information = row.additional_information.replace('£60 savings per year', '£95 savings per year');
  const result = mapToCanonical({
    table,
    previous: { dataset: published('tariffs-2026-09-12.json'), label: 'data/tariffs-2026-09-12.json' }
  });
  const contradiction = result.review_required.find((item) => item.reason === 'carried_value_contradicted_by_source');
  assert.ok(contradiction);
  assert.equal(contradiction.source_max_saving_gbp, 95);
  assert.equal(contradiction.carried_max_saving_gbp, 60);
  const tariff = result.dataset.tariffs.find((t) => t.id === contradiction.product_id);
  assert.ok(!tariff.adjustments.some((a) => a.type === 'discount_cap'));
  const audit = result.carry_forward_audit.find((a) => a.product_id === contradiction.product_id && a.field === 'discount_cap');
  assert.equal(audit.source_contradicts, true);
  assert.equal(audit.value, null);
});

// --- ambiguity is refused, not resolved ------------------------------------

test('a printed row naming a tariff that cannot be accounted for is refused', () => {
  // Page 8 of the Standard table prints one price against three names:
  // "SmartSaver Std 24hr", "Keypad Standard Rate 24hr" and "Standard Rate
  // 24hr", with two payment phrases. The allocation that would "work" drops
  // the first name entirely, so the row is raised instead.
  const review = standard.review_required.find((item) => item.reason === 'ambiguous_product_grouping');
  assert.ok(review);
  assert.equal(review.detail.unaccounted_name_text, 'SmartSaverStd24hr');
  assert.deepEqual(review.detail.printed_name_lines, [
    'SmartSaver Std 24hr',
    'Keypad Standard',
    'Rate 24hr',
    'Standard Rate 24hr'
  ]);
  assert.deepEqual(review.products ?? [], []);
});

test('a name cell that writes the payment method into it is not treated as ambiguous', () => {
  // Share Energy prints "Share Eco 7- Pay on receipt of bill or e- bill" and
  // "Share Eco 7 Keypad" in the name column. Those are one product priced per
  // method, as the 2026-09-12 audit reads them, not separate products.
  const share = economy7.dataset.tariffs.find((t) => t.id === 'share-energy-share-eco-7');
  assert.equal(share.rates.length, 5);
  assert.deepEqual(
    share.rates.map((r) => r.payment_method).sort(),
    ['direct_debit_ebill', 'direct_debit_postal', 'on_receipt_ebill', 'on_receipt_postal', 'prepayment']
  );
});

test('money stated beside a credit that cannot be placed is raised, not dropped', () => {
  const table = assembleTable(fixture('standard'), 'standard');
  const row = table.rows.find((r) => /£80 free credit/i.test(r.additional_information));
  assert.ok(row);
  row.additional_information = row.additional_information.replace('£80 free credit', 'free credit of £80 plus a £25 credit');
  const result = mapToCanonical({
    table,
    previous: { dataset: published('tariffs-standard-2026-09-12.json'), label: 'x' }
  });
  const unplaced = result.review_required.find((item) => item.reason === 'unplaced_credit_amount');
  assert.ok(unplaced, 'an amount the patterns cannot place must become a review item');
  assert.ok(unplaced.amounts.includes('£80'));
});

test('an instalment breakdown is counted once, not added to the total', () => {
  // "£80 free credit (£40 after switchover and £40 after month 9)" is £80, not
  // £160. The schema's credit types are one-off by definition, so the total is
  // one adjustment and the instalments stay in the transcribed notes.
  const tariff = standard.dataset.tariffs.find((t) => /£80 Discount and Keypad 20/.test(t.name));
  assert.ok(tariff);
  assert.deepEqual(tariff.adjustments, [
    { type: 'fixed_credit', amount_gbp: 80, applies: 'first_year', timing: 'unspecified' }
  ]);
  assert.match(tariff.notes, /£40 after switchover and £40 after month 9/);
});

// --- Tier 1 derivations ----------------------------------------------------

test('a percentage discount is never added as an adjustment', () => {
  // The Council prints the already-discounted rate, so an adjustment would
  // double-count it.
  for (const result of [economy7, standard]) {
    for (const tariff of result.dataset.tariffs) {
      assert.ok(
        !tariff.adjustments.some((a) => a.type === 'percentage_discount'),
        `${tariff.id} must not carry a percentage discount adjustment`
      );
      if (tariff.headline_discount_pct !== null) assert.equal(tariff.rate_basis, 'discounted');
    }
  }
});

test('a term stated in the tariff name is read as the source stating it', () => {
  // "1 Year Home Electricity 15% discount" with "Fixed term" in the
  // information column is a 12-month fixed term; the name is as much the
  // source as the column is.
  const tariff = standard.dataset.tariffs.find((t) => t.name === '1 Year Home Electricity 15% discount');
  assert.equal(tariff.contract.type, 'fixed');
  assert.equal(tariff.contract.term_months, 12);
  assert.equal(tariff.intro_period_basis, 'stated_fixed_term');
  assert.equal(tariff.intro_period_months, 12);
  assert.equal(tariff.contract.exit_fee_gbp, 40);
});

test('an exit fee is 0 when the source says there is none and null when it is silent', () => {
  const none = standard.dataset.tariffs.find((t) => /No Exit Fees/i.test(t.notes ?? ''));
  assert.equal(none.contract.exit_fee_gbp, 0);
  const silent = economy7.dataset.tariffs.filter((t) => t.status === 'active' && !/exit fee/i.test(t.notes ?? ''));
  for (const tariff of silent) assert.equal(tariff.contract.exit_fee_gbp, null, `${tariff.id} must leave an unstated exit fee unknown`);
});

test('eligibility is true, false or unknown, never a default', () => {
  const newOnly = standard.dataset.tariffs.find((t) => /new customers only/i.test(t.notes ?? ''));
  assert.equal(newOnly.eligibility.new_customers_only, true);
  const both = economy7.dataset.tariffs.find((t) => /new and existing customers/i.test(t.notes ?? ''));
  assert.equal(both.eligibility.new_customers_only, false);
  const silent = economy7.dataset.tariffs.find((t) => t.status === 'active' && !/customer/i.test(t.notes ?? ''));
  assert.equal(silent.eligibility.new_customers_only, null);
});

// --- withdrawals -----------------------------------------------------------

test('a removal notice changes availability and nothing else', () => {
  const withdrawn = standard.dataset.tariffs.filter((t) => t.status === 'withdrawn');
  assert.equal(withdrawn.length, 4);
  const before = new Map(published('tariffs-standard-2026-09-12.json').tariffs.map((t) => [t.id, t]));
  for (const tariff of withdrawn) {
    const prior = before.get(tariff.id);
    assert.ok(prior, `${tariff.id} must reuse the published id rather than deriving a near-duplicate`);
    assert.deepEqual(tariff.rates, []);
    // The notice says nothing about the terms, so they are retained verbatim.
    assert.deepEqual(tariff.contract, prior.contract);
    assert.equal(tariff.intro_period_basis, prior.intro_period_basis);
    assert.equal(tariff.rate_basis, prior.rate_basis);
  }
});

// --- failure modes ---------------------------------------------------------

test('mapping a table with no rows is refused', () => {
  assert.throws(
    () => mapToCanonical({ table: { family: 'economy7', rows: [], notices: [], totals: {} } }),
    (err) => err instanceof MappingError && err.code === 'NO_SOURCE_ROWS'
  );
});

test('mapping an unknown tariff family is refused', () => {
  assert.throws(
    () => mapToCanonical({ table: { family: 'gas', rows: [{}], notices: [], totals: {} } }),
    (err) => err instanceof MappingError && err.code === 'UNKNOWN_FAMILY'
  );
});

test('mapping is deterministic for identical input', () => {
  assert.equal(JSON.stringify(run('economy7', 'tariffs-2026-09-12.json')), JSON.stringify(economy7));
});

// --- the id convention -----------------------------------------------------

test('canonicalId reproduces every published Economy 7 id from supplier and name', () => {
  const mismatches = published('tariffs-2026-09-12.json')
    .tariffs.map((t) => [t.id, canonicalId(t.supplier, t.name)])
    .filter(([id, derived]) => id !== derived);
  assert.deepEqual(mismatches, []);
});

test('the supplier slug is prefixed only when the name does not already begin with it', () => {
  assert.equal(canonicalId('Budget Energy', 'Keypad Economy 7'), 'budget-energy-keypad-economy-7');
  assert.equal(canonicalId('Budget Energy', 'Budget Energy Keypad Promotional 1 Economy 7'), 'budget-energy-keypad-promotional-1-economy-7');
  assert.equal(canonicalId('Power NI', 'Monthly Direct Debit (E7)'), 'power-ni-monthly-direct-debit-e7');
});
