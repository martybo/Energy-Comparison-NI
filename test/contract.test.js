import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { contractViolations, DATASET_KEYS, TARIFF_KEYS, PAYMENT_METHOD_LABELS, SCHEMA_VERSION } from '../src/contract.js';
import { paymentMethodOptions, paymentMethodSummary } from '../src/format.js';
import { compare, usageFromAnnualSplit } from '../src/calc.js';
import { loadValidated } from '../src/validate.js';
import { assembleTable } from '../scripts/extract/table.mjs';
import { mapToCanonical, MappingError } from '../scripts/extract/map-canonical.mjs';
import { reconcile, renderReconciliation } from '../scripts/extract/reconcile.mjs';

/**
 * The published dataset contract, and the regression it exists for.
 *
 * The first live candidate (#36) carried every tariff correctly and passed
 * every test, yet would have broken the page: the pipeline wrote no
 * `payment_methods` map, so the payment-method filter offered nothing and
 * the result cards showed raw keys; it also dropped `supplier_notes`,
 * `schema_version`, and two fields from every tariff. These tests reproduce
 * that candidate's shape and pin the contract that now refuses it.
 */

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const published = (file) => read(`data/${file}`);
const fixture = (family) => read(`test/fixtures/consumer-council/${family}-text-items.json`);
const map = (family, file, previous = published(file)) =>
  mapToCanonical({ table: assembleTable(fixture(family), family), previous: { dataset: previous, label: `data/${file}` } });

const handEconomy7 = published('tariffs-2026-09-12.json');
const handStandard = published('tariffs-standard-2026-09-12.json');
const economy7 = map('economy7', 'tariffs-2026-09-12.json');
const standard = map('standard', 'tariffs-standard-2026-09-12.json');

/** What #36 shipped: the same tariffs, without the contract's other structure. */
function shapedLike36(dataset) {
  const copy = structuredClone(dataset);
  delete copy.schema_version;
  delete copy.payment_methods;
  delete copy.supplier_notes;
  for (const t of copy.tariffs) {
    if (t.status === 'withdrawn') continue;
    delete t.headline_discount_wording;
    delete t.start_date;
  }
  return copy;
}

const codes = (violations) => [...new Set(violations.map((v) => v.code))].sort();

// --- the contract itself ------------------------------------------------------

test('both hand-audited 12/09 datasets meet the contract', () => {
  assert.deepEqual(contractViolations(handEconomy7), []);
  assert.deepEqual(contractViolations(handStandard), []);
});

test('a dataset shaped like candidate #36 is refused, naming everything it dropped', () => {
  const violations = contractViolations(shapedLike36(handEconomy7));
  assert.deepEqual(codes(violations), ['missing_key', 'missing_tariff_field', 'payment_method_unlabelled']);
  assert.deepEqual(
    violations.filter((v) => v.code === 'missing_key').map((v) => v.where).sort(),
    ['payment_methods', 'schema_version', 'supplier_notes']
  );
  const unlabelled = violations.filter((v) => v.code === 'payment_method_unlabelled').map((v) => v.where);
  assert.equal(unlabelled.length, 5, 'every method the tariffs are priced for is named');
  const fields = new Set(violations.filter((v) => v.code === 'missing_tariff_field').map((v) => v.where.split('.').pop()));
  assert.deepEqual([...fields].sort(), ['headline_discount_wording', 'start_date']);
});

test('null is a value: a field the source does not state passes, an absent one does not', () => {
  const dataset = structuredClone(handEconomy7);
  dataset.tariffs[0].start_date = null;
  dataset.tariffs[0].headline_discount_wording = null;
  assert.deepEqual(contractViolations(dataset), []);
  delete dataset.tariffs[0].start_date;
  assert.deepEqual(codes(contractViolations(dataset)), ['missing_tariff_field']);
});

test('a label must exist for every priced method, and be non-empty', () => {
  const dataset = structuredClone(handEconomy7);
  delete dataset.payment_methods.prepayment;
  assert.deepEqual(codes(contractViolations(dataset)), ['payment_method_unlabelled']);
  dataset.payment_methods.prepayment = '  ';
  assert.ok(codes(contractViolations(dataset)).includes('payment_method_label_empty'));
  dataset.payment_methods = { ...PAYMENT_METHOD_LABELS, cheque: 'Cheque' };
  assert.deepEqual(codes(contractViolations(dataset)), ['payment_method_unknown']);
});

test('the wrong schema_version, or an empty supplier note, is refused', () => {
  const dataset = structuredClone(handEconomy7);
  dataset.schema_version = 1;
  dataset.supplier_notes['Share Energy'] = '';
  assert.deepEqual(codes(contractViolations(dataset)), ['schema_version', 'supplier_note_empty']);
});

test('against the published dataset, nothing it carries may be dropped, even outside the named contract', () => {
  const reference = structuredClone(handEconomy7);
  reference.dataset.compiled_by = 'hand';
  for (const t of reference.tariffs) t.audit_ref = 'x';
  const violations = contractViolations(handEconomy7, { reference });
  assert.deepEqual(codes(violations), ['dropped_header_field', 'dropped_tariff_field']);
  assert.equal(violations.filter((v) => v.code === 'dropped_tariff_field').length, handEconomy7.tariffs.length);
});

// --- the page: the filter and the result cards ------------------------------

test('the #36 shape leaves the payment-method filter empty; the contract shape fills it', () => {
  // Exactly what #36 would have served: both datasets without labels.
  assert.deepEqual(paymentMethodOptions(shapedLike36(economy7.dataset), shapedLike36(standard.dataset)), []);

  const options = paymentMethodOptions(economy7.dataset, standard.dataset);
  assert.deepEqual(
    options.map((o) => o.value),
    Object.keys(PAYMENT_METHOD_LABELS),
    'every priced method is offered'
  );
  for (const o of options) assert.equal(o.label, PAYMENT_METHOD_LABELS[o.value]);
});

test('result cards name payment methods by label, never by raw key', () => {
  const rawKey = new RegExp(`\\b(${Object.keys(PAYMENT_METHOD_LABELS).join('|')})\\b`);
  const usage = usageFromAnnualSplit(3200, 40);
  for (const dataset of [economy7.dataset, standard.dataset]) {
    const { dataset: loaded } = loadValidated(dataset);
    const res = compare(loaded, { usage, limit: 100 });
    assert.ok(res.results.length > 0);
    for (const result of res.results) {
      const shown = [
        paymentMethodSummary(result, res.paymentMethodLabels),
        ...(result.alternativePaymentMethods || []).map((a) => res.paymentMethodLabels[a.paymentMethod] || a.paymentMethod)
      ];
      for (const text of shown) assert.doesNotMatch(text, rawKey, `${result.id}: "${text}"`);
    }
  }
});

// --- the pipeline writes the contract --------------------------------------

test('the mapped datasets meet the contract against the published ones, in the published key order', () => {
  for (const [result, reference] of [[economy7, handEconomy7], [standard, handStandard]]) {
    assert.deepEqual(contractViolations(result.dataset, { reference }), []);
    assert.deepEqual(Object.keys(result.dataset), DATASET_KEYS);
    assert.equal(result.dataset.schema_version, SCHEMA_VERSION);
    assert.deepEqual(result.dataset.payment_methods, PAYMENT_METHOD_LABELS);
    for (const t of result.dataset.tariffs) assert.deepEqual(Object.keys(t), TARIFF_KEYS, t.id);
  }
});

test('supplier notes are the notices the source prints, for the suppliers it prints them for', () => {
  // The hand-audited datasets paraphrased the same notices; the keys are the
  // independent check that each notice was attributed to the right supplier.
  assert.deepEqual(Object.keys(economy7.dataset.supplier_notes).sort(), Object.keys(handEconomy7.supplier_notes).sort());
  assert.deepEqual(Object.keys(standard.dataset.supplier_notes).sort(), Object.keys(handStandard.supplier_notes).sort());
  assert.match(economy7.dataset.supplier_notes['Click Energy'], /^The source states: "Click Energy tariff removal: .*Keypad Economy 7 Saver"$/);
  assert.equal(economy7.dataset.supplier_notes['Share Energy'], 'The source states: "Tariff change scheduled for 01 October 2026. Contact our team to check how this could impact you."');
  assert.match(standard.dataset.supplier_notes['SSE Airtricity'], /scheduled for 01 August 2026/);
});

test('a notice printed on a page shared by two suppliers is not guessed onto either', () => {
  // The captured tables print one supplier per page, so one is made here: a
  // second supplier's row is placed on the page the notice is printed on.
  const table = assembleTable(fixture('economy7'), 'economy7');
  const first = table.rows[0];
  const other = table.rows.find((r) => r.supplier !== first.supplier);
  other.page = first.page;
  table.notices.push({ kind: 'scheduled_change', page: first.page, heading: null, text: 'Tariff change scheduled.', listed: [] });

  const result = mapToCanonical({ table, previous: { dataset: handEconomy7, label: 'data/tariffs-2026-09-12.json' } });
  const item = result.review_required.find((r) => r.reason === 'notice_unattributed');
  assert.ok(item, 'raised for review');
  assert.equal(item.detail.page, first.page);
  for (const note of Object.values(result.dataset.supplier_notes)) assert.doesNotMatch(note, /Tariff change scheduled\.$/);
});

test('headline wording and start date are read from the source, and agree with the hand audit', () => {
  // Four Standard start dates differ, and the source settles it: those SSE
  // rows print no start date (their Economy 7 counterparts do), so the hand
  // transcription carried one across. Unstated is null, never inferred.
  const notPrinted = new Set([
    'sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr',
    'sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-standard',
    'sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-standard',
    'sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-standard'
  ]);
  for (const [result, hand] of [[economy7, handEconomy7], [standard, handStandard]]) {
    const byId = new Map(hand.tariffs.map((t) => [t.id, t]));
    for (const t of result.dataset.tariffs) {
      const h = byId.get(t.id);
      if (!h) continue;
      assert.equal(t.headline_discount_wording, h.headline_discount_wording, `${t.id} headline_discount_wording`);
      if (notPrinted.has(t.id)) {
        assert.equal(t.start_date, null, t.id);
        assert.doesNotMatch(t.notes ?? '', /start\s*date/i, `${t.id}: the source prints no start date`);
        assert.equal(h.start_date, '2026-08-01');
      } else {
        assert.equal(t.start_date, h.start_date, `${t.id} start_date`);
      }
    }
  }
});

test('the mapper refuses to propose a dataset that drops what the published one carries', () => {
  const reference = structuredClone(handEconomy7);
  for (const t of reference.tariffs) t.audit_ref = 'x';
  assert.throws(
    () => map('economy7', 'tariffs-2026-09-12.json', reference),
    (error) => error instanceof MappingError && error.code === 'DATASET_CONTRACT' && error.details.violations.every((v) => v.code === 'dropped_tariff_field')
  );
});

// --- the reconciliation names every field ----------------------------------

test('fields the published dataset lacks are reported as restored, not as product changes', () => {
  const r2 = published('tariffs-standard-2026-09-12-r2.json');
  const report = reconcile({ candidate: standard, published: r2, publishedLabel: 'data/tariffs-standard-2026-09-12-r2.json' });
  assert.deepEqual(report.restored_fields.dataset.map((f) => f.field), ['schema_version', 'payment_methods', 'supplier_notes']);
  assert.deepEqual(report.restored_fields.tariffs.map((f) => f.field).sort(), ['headline_discount_wording', 'start_date']);
  for (const c of [...report.products.changed, ...report.products.wording_only]) {
    for (const f of c.fields) assert.ok(!['headline_discount_wording', 'start_date'].includes(f.field), `${c.id} lists ${f.field} as a change`);
  }
  assert.match(renderReconciliation(report), /## Fields the published dataset did not carry/);
});

test('a changed field outside the old comparison list is still reported', () => {
  const previous = structuredClone(handEconomy7);
  const target = previous.tariffs.find((t) => t.headline_discount_wording === 'up_to');
  target.headline_discount_wording = 'exact';
  const report = reconcile({ candidate: economy7, published: previous, publishedLabel: 'test' });
  const entry = report.products.changed.find((c) => c.id === target.id);
  assert.ok(entry, `${target.id} is reported as changed`);
  assert.deepEqual(entry.fields.find((f) => f.field === 'headline_discount_wording'), { field: 'headline_discount_wording', from: 'exact', to: 'up_to' });
  assert.ok(entry.fields.every((f) => f.field === 'headline_discount_wording' || f.field === 'notes'), 'only the field changed, and the transcribed wording');
});
