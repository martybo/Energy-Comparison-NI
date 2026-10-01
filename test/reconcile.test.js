import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assembleTable } from '../scripts/extract/table.mjs';
import { mapToCanonical } from '../scripts/extract/map-canonical.mjs';
import { reconcile, renderReconciliation } from '../scripts/extract/reconcile.mjs';

/**
 * The reconciliation is what a person actually reads before publishing a
 * month's tariffs, so these tests are about whether it would tell them the
 * truth: every printed payment slot accounted for, every real change named,
 * and nothing publishable while a question is open.
 */

const fixture = (family) => JSON.parse(readFileSync(`test/fixtures/consumer-council/${family}-text-items.json`, 'utf8'));
const dataset = (file) => JSON.parse(readFileSync(`data/${file}`, 'utf8'));

function report(family, file) {
  const published = dataset(file);
  const candidate = mapToCanonical({
    table: assembleTable(fixture(family), family),
    previous: { dataset: published, label: `data/${file}` }
  });
  return reconcile({ candidate, published, publishedLabel: `data/${file}` });
}

const economy7 = report('economy7', 'tariffs-2026-09-12.json');
const standard = report('standard', 'tariffs-standard-2026-09-12.json');

test('every printed payment slot is accounted for in both families', () => {
  for (const [family, r] of [['economy7', economy7], ['standard', standard]]) {
    const a = r.slot_accounting;
    assert.equal(
      a.mapped_rate_rows + a.page_break_repeats + a.slots_in_unresolved_rows,
      a.printed_slots,
      `${family}: ${a.printed_slots} slots printed, ${a.mapped_rate_rows} mapped — a slot was gained or lost`
    );
    assert.equal(a.balanced, true);
  }
});

test('an unbalanced slot count is a gate, not a footnote', () => {
  const published = dataset('tariffs-2026-09-12.json');
  const candidate = mapToCanonical({
    table: assembleTable(fixture('economy7'), 'economy7'),
    previous: { dataset: published, label: 'x' }
  });
  // Simulate a rate row lost between mapping and the dataset.
  candidate.dataset.tariffs[0].rates.pop();
  candidate.totals.rate_rows -= 1;
  const r = reconcile({ candidate, published });
  assert.equal(r.slot_accounting.balanced, false);
  assert.equal(r.publishable, false);
  assert.ok(r.gates.some((g) => g.kind === 'slot_accounting_unbalanced'));
});

test('the Economy 7 candidate is publishable and changes nothing material', () => {
  // The whole table read from the PDF agrees with the hand audit: no product
  // added or removed, and no rate, term, credit or eligibility field moved.
  assert.equal(economy7.publishable, true);
  assert.deepEqual(economy7.products.added, []);
  assert.deepEqual(economy7.products.removed, []);
  assert.deepEqual(economy7.products.changed, []);
});

test('a candidate with an open review item is never publishable', () => {
  assert.ok(standard.gates.length > 0);
  assert.equal(standard.publishable, false);
});

test('the extra Standard payment slot is reported as a change, not suppressed', () => {
  // The source prints 46 slots where the published dataset records 45. The
  // missing one is Budget Energy's 29% discount on direct debit e-bill.
  const entry = standard.products.changed.find((c) => c.id === 'budget-energy-bill-pay-29-discount');
  assert.ok(entry, 'the extra slot must appear as a change to the affected product');
  assert.deepEqual(entry.rates.added, ['direct_debit_ebill']);
});

test('a suspected rename is reported and never acted on', () => {
  const rename = standard.suspected_renames.find((r) => r.previous_id.includes('1-year-keypad'));
  assert.ok(rename);
  assert.equal(rename.candidate_id, 'sse-airtricity-1-year-home-keypad-10-5-discount-plus-30-welcome-credit-24hr');
  // Reported as a pair, but both sides still appear as added and removed: the
  // reconciliation does not merge them behind the reviewer's back.
  assert.ok(standard.products.added.some((t) => t.id === rename.candidate_id));
  assert.ok(standard.products.removed.some((t) => t.id === rename.previous_id));
});

test('a record differing only in transcribed wording is separated from a material change', () => {
  assert.ok(economy7.products.wording_only.length > 0);
  for (const entry of economy7.products.wording_only) {
    assert.deepEqual(entry.fields.map((f) => f.field), ['notes']);
    assert.deepEqual(entry.rates, { added: [], removed: [], repriced: [] });
  }
});

test('a changed rate is named with its payment method, field and both values', () => {
  const published = dataset('tariffs-2026-09-12.json');
  const candidate = mapToCanonical({
    table: assembleTable(fixture('economy7'), 'economy7'),
    previous: { dataset: published, label: 'x' }
  });
  const tariff = candidate.dataset.tariffs.find((t) => t.rates.length > 0);
  tariff.rates[0].day_p_per_kwh = 99.999;
  const r = reconcile({ candidate, published });
  const entry = r.products.changed.find((c) => c.id === tariff.id);
  assert.deepEqual(entry.rates.repriced, [
    {
      payment_method: tariff.rates[0].payment_method,
      field: 'day_p_per_kwh',
      from: published.tariffs.find((t) => t.id === tariff.id).rates.find((x) => x.payment_method === tariff.rates[0].payment_method).day_p_per_kwh,
      to: 99.999
    }
  ]);
});

test('the rendered report states the gates and the slot accounting up front', () => {
  const markdown = renderReconciliation(standard);
  assert.match(markdown, /open gates?\./);
  assert.match(markdown, /\| Payment-method slots printed \| 46 \|/);
  assert.match(markdown, /## Gates/);
  assert.match(markdown, /ambiguous_product_grouping/);
  assert.match(markdown, /## Carried-forward domain knowledge/);
  assert.match(markdown, /Source contradicts/);
});

test('a clean report says so rather than implying review is unnecessary', () => {
  const markdown = renderReconciliation(economy7);
  assert.match(markdown, /No open gates\./);
  assert.match(markdown, /still requires human review before it is published/);
});
