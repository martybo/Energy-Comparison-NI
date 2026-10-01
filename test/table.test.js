import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assembleTable, TableAssemblyError, TABLE_SCHEMAS, PAYMENT_METHOD_PHRASES } from '../scripts/extract/table.mjs';

/**
 * Table assembly is tested two ways.
 *
 * Against the real documents' captured text layer, to prove it reproduces
 * figures that were established by hand: docs/RECONCILIATION-2026-09-12.md
 * counted 30 priced rows, 42 payment-method slots and 5 suppliers in the
 * Economy 7 PDF, per supplier as well as in total. Those numbers are a
 * human audit of the source, not an output of this code, so reproducing
 * them independently is the check that carries weight.
 *
 * And against small synthetic item sets, to provoke each structural failure
 * deliberately and to prove the properties that matter cannot silently
 * break — above all that rates follow their column *labels* rather than
 * their positions, since the real documents move their columns between
 * pages and a shifted day/night rate would be a plausible-looking lie.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = (family) =>
  JSON.parse(readFileSync(`${root}test/fixtures/consumer-council/${family}-text-items.json`, 'utf8'));

const economy7 = assembleTable(fixture('economy7'), 'economy7');
const standard = assembleTable(fixture('standard'), 'standard');

// --- reproducing the human audit of the real documents ---------------------

test('Economy 7: reproduces the reconciliation’s audited row, slot and supplier counts', () => {
  assert.equal(economy7.totals.priced_rows, 30);
  assert.equal(economy7.totals.payment_method_slots, 42);
  assert.equal(economy7.totals.suppliers, 5);
  assert.equal(economy7.totals.table_pages, 9);
});

test('Economy 7: reproduces the reconciliation’s audited per-supplier rate-row counts', () => {
  const slotsBySupplier = {};
  for (const row of economy7.rows) {
    slotsBySupplier[row.supplier] = (slotsBySupplier[row.supplier] ?? 0) + row.payment_methods.length;
  }
  assert.deepEqual(slotsBySupplier, {
    'Budget Energy': 6,
    'Click Energy': 5,
    'Power NI': 7,
    'SSE Airtricity': 15,
    'Share Energy': 9
  });
});

test('Economy 7: every priced row matches the committed source-row trace page for page and slot for slot', () => {
  const trace = JSON.parse(readFileSync(`${root}docs/source-rows-2026-09-12.json`, 'utf8'));
  assert.equal(economy7.rows.length, trace.length);
  for (const [index, row] of economy7.rows.entries()) {
    assert.equal(row.page, trace[index][0], `row ${row.index} page`);
    assert.equal(row.payment_methods.length, trace[index][1], `row ${row.index} payment-method slots`);
  }
});

test('Standard: 35 priced rows and 5 suppliers, as audited', () => {
  assert.equal(standard.totals.priced_rows, 35);
  assert.equal(standard.totals.suppliers, 5);
});

test('Standard: prints 46 payment-method slots, one more than the committed dataset records', () => {
  // Investigated rather than reconciled away (issue #17). The PDF prints two
  // payment methods for "Budget Energy Bill Pay 29% Discount" — "Direct Debit
  // postal bill" and "Direct Debit e-bill", stacked in the payment column
  // within that row's extent — but the hand-transcribed dataset records only
  // direct_debit_postal. The reconciliation's "45 slots = 45 rate rows" is
  // internally consistent yet one slot short of the source. This test pins
  // the source's own figure so the gap cannot quietly disappear.
  assert.equal(standard.totals.payment_method_slots, 46);

  const row = standard.rows.find((r) => r.tariff_name === 'Budget Energy Bill Pay 29% Discount');
  assert.deepEqual(
    row.payment_methods.map((p) => p.method),
    ['direct_debit_postal', 'direct_debit_ebill']
  );
});

test('both families read their own stated comparison date and VAT basis', () => {
  assert.equal(economy7.source.comparison_date, '2026-09-13');
  assert.equal(standard.source.comparison_date, '2026-09-12');
  for (const table of [economy7, standard]) {
    assert.equal(table.source.vat_percent, 5);
    assert.equal(table.source.vat_treatment, 'inclusive');
    assert.equal(table.source.typical_annual_kwh, 3200);
  }
});

test('multi-line tariff names and conditions stay attached to their own row', () => {
  // "Budget Energy Keypad Promotional 1 Economy 7" is printed across three
  // lines, and its conditions across five, while the next row begins below.
  const row = economy7.rows[0];
  assert.equal(row.tariff_name, 'Budget Energy Keypad Promotional 1 Economy 7');
  assert.match(row.additional_information, /No security deposit/);
  assert.match(row.additional_information, /£40 welcome credit/);
  assert.match(row.additional_information, /Only available for new customers/);
  // The following row's own conditions must not have leaked upwards.
  assert.doesNotMatch(row.additional_information, /No security deposit\. No exit fee\.$/);
  assert.equal(economy7.rows[1].tariff_name, 'Keypad Economy 7');
});

test('stacked payment methods in one cell are recovered in printed order', () => {
  const row = economy7.rows.find((r) => r.tariff_name === 'Bill Pay Economy 7' && r.supplier === 'Budget Energy');
  assert.deepEqual(
    row.payment_methods.map((p) => p.method),
    ['on_receipt_ebill', 'direct_debit_ebill', 'direct_debit_postal', 'on_receipt_postal']
  );
});

test('a payment phrase broken across lines by the PDF is still recognised', () => {
  // The source wraps "Direct Debit e-bill" as "Direct Debit e-" / "bill".
  const row = economy7.rows.find((r) => r.tariff_name === 'Monthly Direct Debit with online billing (E7)');
  assert.deepEqual(row.payment_methods.map((p) => p.method), ['direct_debit_ebill']);
  assert.match(row.payment_method_text, /Direct Debit e-\s*bill/);
});

test('rates are read per family: Economy 7 day/night, standard unit plus the source’s annual cost', () => {
  const e7 = economy7.rows[0];
  assert.deepEqual(e7.rates, { day_p_per_kwh: 37.03, night_p_per_kwh: 18.07, standing_p_per_day: 24.7 });

  const std = standard.rows[0];
  assert.deepEqual(std.rates, { unit_p_per_kwh: 29.83, standing_p_per_day: 15.94, source_annual_cost_gbp: 1013 });
});

test('withdrawal notices are captured as notices, never as priced rows', () => {
  const removal = economy7.notices.find((n) => n.kind === 'section_notice');
  assert.match(removal.heading, /Click Energy tariff removal/);
  assert.deepEqual(removal.listed, ['Bill Pay Economy 7 Saver', 'Keypad Economy 7 Saver']);
  // The named tariffs are not priced rows: they were removed from the table.
  for (const name of removal.listed) {
    assert.equal(economy7.rows.some((r) => r.tariff_name === name), false, `${name} must not be a priced row`);
  }

  const standardRemoval = standard.notices.find((n) => n.kind === 'section_notice');
  assert.deepEqual(standardRemoval.listed, [
    'Bill Pay Round the Clock',
    'Keypad Round the Clock',
    'Bill Pay Twilight',
    'Keypad Twilight'
  ]);
});

test('scheduled future changes are captured as notices, not folded into current rates', () => {
  const scheduled = economy7.notices.filter((n) => n.kind === 'scheduled_change');
  assert.equal(scheduled.length, 1);
  assert.match(scheduled[0].text, /scheduled for 01 October 2026/);

  const standardScheduled = standard.notices.filter((n) => n.kind === 'scheduled_change');
  assert.deepEqual(
    // The date is printed as its own styled run, so the sentence arrives in
    // pieces and is rejoined without the stray space before the full stop.
    standardScheduled.map((n) => /scheduled for ([^.]+?)\s*\./.exec(n.text)?.[1]),
    ['01 August 2026', '01 October 2026']
  );
});

test('assembly is deterministic for identical input', () => {
  assert.equal(JSON.stringify(assembleTable(fixture('economy7'), 'economy7')), JSON.stringify(economy7));
});

// --- synthetic structures: the properties that must not silently break -----

const HEADER_SIZE = 6;
const BODY_SIZE = 7;

/** Builds a one-page item set with the given column order and one priced row. */
function syntheticPage({ headers, cells, supplierHeading = 'Budget Energy', footer = true }) {
  const items = [];
  if (supplierHeading) items.push({ page: 1, x: 62.4, y: 740, fontName: 'F2', fontSize: 12, text: supplierHeading });
  headers.forEach(({ label, x }) => {
    items.push({ page: 1, x, y: 700, fontName: 'F2', fontSize: HEADER_SIZE, text: label });
  });
  cells.forEach(({ x, y, text }) => {
    items.push({ page: 1, x, y, fontName: 'F1', fontSize: BODY_SIZE, text });
  });
  if (footer) {
    items.push({
      page: 2,
      x: 70,
      y: 687,
      fontName: 'F1',
      fontSize: 8,
      text: 'Prices for 13/09/2026 including VAT of 5%. Some tariffs may be available to new customers only. (Annual cost is'
    });
    items.push({ page: 2, x: 70, y: 675, fontName: 'F1', fontSize: 8, text: 'calculated using a typical annual consumption of 3,200kWh' });
  }
  return { pageCount: 2, fontCount: 2, items };
}

const E7_HEADERS_IN_ORDER = TABLE_SCHEMAS.economy7.headers.map((label, i) => ({ label, x: 60 + i * 60 }));

test('columns are located by header text, so a column that moves to a new x is still read correctly', () => {
  // This is the case that actually occurs: the real Economy 7 PDF prints its
  // day-rate column at x=260.0 on page 2 and x=242.9 on page 3, and its
  // conditions column at 444.1 and 482.1. Fixed positional bands would
  // mis-assign those cells; reading each page's own header row does not.
  const shifted = [
    { label: 'SUPPLIER', x: 67.1 },
    { label: 'TARIFF NAME', x: 110.7 },
    { label: 'PAYMENT & BILLING METHOD', x: 168.7 },
    { label: 'DAY UNIT RATE PENCE PER UNIT/KWH', x: 242.9 },
    { label: 'NIGHT UNIT RATE PENCE PER UNIT/KWH', x: 322.6 },
    { label: 'STANDING CHARGE PENCE PER DAY', x: 405.5 },
    { label: 'ADDITIONAL INFORMATION', x: 482.1 }
  ];
  const table = assembleTable(
    syntheticPage({
      headers: shifted,
      cells: [
        { x: 67.1, y: 660, text: 'Budget Energy' },
        { x: 110.7, y: 660, text: 'Keypad Economy 7' },
        { x: 168.7, y: 660, text: 'Prepayment meter' },
        { x: 242.9, y: 660, text: '37.030p' },
        { x: 322.6, y: 660, text: '18.070p' },
        { x: 405.5, y: 660, text: '24.700p' },
        { x: 482.1, y: 660, text: 'No exit fee.' }
      ]
    }),
    'economy7'
  );
  assert.deepEqual(table.rows[0].rates, { day_p_per_kwh: 37.03, night_p_per_kwh: 18.07, standing_p_per_day: 24.7 });
});

test('a table whose columns are printed in a different order is refused, not reinterpreted', () => {
  // Deliberately conservative. Following the labels would in fact read a
  // swapped day/night table correctly, but column order has never varied —
  // it is identical across all nine table pages of both documents, while
  // only x positions move. A reordered table is therefore a materially
  // changed source, and this is electricity pricing: a human should look
  // before the pipeline carries on producing candidate tariff data from it.
  const reordered = [
    { label: 'SUPPLIER', x: 60 },
    { label: 'TARIFF NAME', x: 120 },
    { label: 'PAYMENT & BILLING METHOD', x: 180 },
    { label: 'NIGHT UNIT RATE PENCE PER UNIT/KWH', x: 240 },
    { label: 'DAY UNIT RATE PENCE PER UNIT/KWH', x: 300 },
    { label: 'STANDING CHARGE PENCE PER DAY', x: 360 },
    { label: 'ADDITIONAL INFORMATION', x: 420 }
  ];
  assert.throws(
    () =>
      assembleTable(
        syntheticPage({
          headers: reordered,
          cells: [
            { x: 60, y: 660, text: 'Budget Energy' },
            { x: 120, y: 660, text: 'Keypad Economy 7' },
            { x: 180, y: 660, text: 'Prepayment meter' },
            { x: 240, y: 660, text: '18.070p' },
            { x: 300, y: 660, text: '37.030p' },
            { x: 360, y: 660, text: '24.700p' },
            { x: 420, y: 660, text: 'No exit fee.' }
          ]
        }),
        'economy7'
      ),
    (err) => err instanceof TableAssemblyError && err.code === 'UNEXPECTED_TABLE_HEADERS'
  );
});

test('a table whose headers do not match the family schema is refused', () => {
  const headers = [...E7_HEADERS_IN_ORDER];
  headers[3] = { label: 'PEAK UNIT RATE PENCE PER UNIT/KWH', x: headers[3].x };
  assert.throws(
    () =>
      assembleTable(
        syntheticPage({
          headers,
          cells: [
            { x: 60, y: 660, text: 'Budget Energy' },
            { x: 120, y: 660, text: 'Keypad Economy 7' },
            { x: 180, y: 660, text: 'Prepayment meter' },
            { x: 180 + 60, y: 660, text: '37.030p' },
            { x: 180 + 120, y: 660, text: '18.070p' },
            { x: 180 + 180, y: 660, text: '24.700p' }
          ]
        }),
        'economy7'
      ),
    (err) => err instanceof TableAssemblyError && err.code === 'UNEXPECTED_TABLE_HEADERS'
  );
});

test('the standard table is refused when read as Economy 7, and vice versa', () => {
  // The families are deliberately separate schemas, not one loose parser.
  assert.throws(
    () => assembleTable(fixture('standard'), 'economy7'),
    (err) => err instanceof TableAssemblyError && err.code === 'UNEXPECTED_TABLE_HEADERS'
  );
  assert.throws(
    () => assembleTable(fixture('economy7'), 'standard'),
    (err) => err instanceof TableAssemblyError && err.code === 'UNEXPECTED_TABLE_HEADERS'
  );
});

test('an unknown tariff family is refused', () => {
  assert.throws(
    () => assembleTable(fixture('economy7'), 'gas'),
    (err) => err instanceof TableAssemblyError && err.code === 'UNKNOWN_FAMILY'
  );
});

const pricedRowCells = (overrides = {}) => [
  { x: 60, y: 660, text: overrides.supplier ?? 'Budget Energy' },
  { x: 120, y: 660, text: overrides.name ?? 'Keypad Economy 7' },
  { x: 180, y: 660, text: overrides.payment ?? 'Prepayment meter' },
  { x: 240, y: 660, text: overrides.day ?? '37.030p' },
  { x: 300, y: 660, text: overrides.night ?? '18.070p' },
  { x: 360, y: 660, text: overrides.standing ?? '24.700p' },
  { x: 420, y: 660, text: 'No exit fee.' }
];

const assembleSynthetic = (overrides) =>
  assembleTable(syntheticPage({ headers: E7_HEADERS_IN_ORDER, cells: pricedRowCells(overrides) }), 'economy7');

test('a rate that is not a pence value is refused rather than coerced', () => {
  assert.throws(
    () => assembleSynthetic({ day: 'TBC' }),
    (err) => err instanceof TableAssemblyError && err.code === 'UNPARSEABLE_RATE'
  );
});

test('payment wording the mapping does not recognise is refused rather than dropped', () => {
  // A silently dropped method would misrepresent what the tariff is sold on.
  assert.throws(
    () => assembleSynthetic({ payment: 'Prepayment meter Smart Pay As You Go' }),
    (err) => err instanceof TableAssemblyError && err.code === 'UNRECOGNISED_PAYMENT_METHOD'
  );
});

test('a supplier cell that disagrees with its section heading is refused', () => {
  assert.throws(
    () => assembleSynthetic({ supplier: 'Click Energy' }),
    (err) => err instanceof TableAssemblyError && err.code === 'SUPPLIER_SECTION_MISMATCH'
  );
});

test('a document that states no comparison date and VAT basis is refused', () => {
  assert.throws(
    () =>
      assembleTable(
        syntheticPage({ headers: E7_HEADERS_IN_ORDER, cells: pricedRowCells(), footer: false }),
        'economy7'
      ),
    (err) => err instanceof TableAssemblyError && err.code === 'MISSING_SOURCE_STATEMENT'
  );
});

test('a document with headers but no priced rows is refused', () => {
  assert.throws(
    () => assembleTable(syntheticPage({ headers: E7_HEADERS_IN_ORDER, cells: [] }), 'economy7'),
    (err) => err instanceof TableAssemblyError && err.code === 'NO_PRICED_ROWS'
  );
});

test('no text items at all is refused', () => {
  assert.throws(
    () => assembleTable({ pageCount: 0, items: [] }, 'economy7'),
    (err) => err instanceof TableAssemblyError && err.code === 'NO_TEXT_ITEMS'
  );
});

test('every payment phrase maps to a canonical payment method used by the validator', () => {
  const canonical = ['prepayment', 'direct_debit_ebill', 'direct_debit_postal', 'on_receipt_ebill', 'on_receipt_postal'];
  for (const { method } of PAYMENT_METHOD_PHRASES) assert.ok(canonical.includes(method), `${method} is not canonical`);
  assert.equal(new Set(PAYMENT_METHOD_PHRASES.map((p) => p.method)).size, canonical.length);
});

test('every real row carries its own provenance: page, supplier, name, rates and source wording', () => {
  for (const table of [economy7, standard]) {
    for (const row of table.rows) {
      assert.ok(row.page >= 1);
      assert.ok(row.supplier.length > 0);
      assert.ok(row.tariff_name.length > 0);
      assert.ok(row.payment_methods.length > 0);
      assert.ok(row.payment_method_text.length > 0);
      assert.ok(row.printed_lines >= 1);
      for (const value of Object.values(row.rates)) assert.ok(Number.isFinite(value));
    }
  }
});
