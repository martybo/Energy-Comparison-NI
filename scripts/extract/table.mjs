/**
 * Assembles the Consumer Council price comparison table from the positioned
 * text layer produced by pdf-text.mjs.
 *
 * The governing design decision: **columns are identified by their header
 * text, never by x position.** The real documents move their columns between
 * pages — in the Economy 7 PDF "TARIFF NAME" sits at x=109.5 on page 2 and
 * x=110.7 on page 3, and the day-rate column moves from 260.0 to 242.9 —
 * so positional bands would silently mis-assign cells. Reading the header
 * row on each page and requiring it to match the family's expected schema
 * also makes a swapped day/night column structurally impossible to
 * misinterpret: the rates follow their labels.
 *
 * The two families are deliberately separate table schemas, because they
 * genuinely differ: Economy 7 prints DAY and NIGHT unit rates, the standard
 * table prints one PRICE IN PENCE column plus the source's own ANNUAL COST.
 * A document whose headers do not match its family's schema is a hard
 * failure, not something to interpret loosely.
 *
 * Verified against the real current documents (issue #17). The assembler
 * independently reproduces counts from the human-audited reconciliation in
 * docs/RECONCILIATION-2026-09-12.md — 30 priced rows, 42 payment-method
 * slots and 5 suppliers for Economy 7 — which is the check that matters:
 * those figures were established by hand from the PDF, not by this code.
 */

import { PdfExtractionError } from './pdf-text.mjs';

export class TableAssemblyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TableAssemblyError';
    this.code = code;
    this.details = details;
  }
}

/** Body text and header text are set at these sizes throughout both documents. */
const HEADER_FONT_SIZE = 6;
const BODY_FONT_SIZE = 7;
const SUPPLIER_HEADING_FONT_SIZE = 12;
const NOTICE_HEADING_FONT_SIZE = 16.5;
const SCHEDULED_NOTICE_FONT_SIZE = 9;
const PROSE_FONT_SIZE = 11;

/** Lines within this many points of each other are the same printed line. */
const Y_TOLERANCE = 2.0;
/** A cell may be indented slightly relative to its column header. */
const X_TOLERANCE = 3.0;

export const TABLE_SCHEMAS = {
  economy7: {
    label: 'Economy 7',
    headers: [
      'SUPPLIER',
      'TARIFF NAME',
      'PAYMENT & BILLING METHOD',
      'DAY UNIT RATE PENCE PER UNIT/KWH',
      'NIGHT UNIT RATE PENCE PER UNIT/KWH',
      'STANDING CHARGE PENCE PER DAY',
      'ADDITIONAL INFORMATION'
    ],
    // Columns whose presence marks the start of a priced row, in the order
    // they must appear. Rates are read by label, so they cannot be shifted.
    rateFields: [
      { field: 'day_p_per_kwh', header: 'DAY UNIT RATE PENCE PER UNIT/KWH', kind: 'pence' },
      { field: 'night_p_per_kwh', header: 'NIGHT UNIT RATE PENCE PER UNIT/KWH', kind: 'pence' },
      { field: 'standing_p_per_day', header: 'STANDING CHARGE PENCE PER DAY', kind: 'pence' }
    ]
  },
  standard: {
    label: 'Standard (24-hour)',
    headers: [
      'SUPPLIER',
      'TARIFF NAME',
      'PAYMENT & BILLING METHOD',
      'PRICE IN PENCE PER UNIT/KWH',
      'STANDING CHARGE PENCE PER DAY',
      'ANNUAL COST USING 3,200 UNITS/KWH',
      'ADDITIONAL INFORMATION'
    ],
    rateFields: [
      { field: 'unit_p_per_kwh', header: 'PRICE IN PENCE PER UNIT/KWH', kind: 'pence' },
      { field: 'standing_p_per_day', header: 'STANDING CHARGE PENCE PER DAY', kind: 'pence' },
      // The source's own annual figure. docs/DATA.md is explicit that this is
      // never the dataset's own number — the standard table states it does
      // not account for incentives — so it is carried only as a cross-check.
      { field: 'source_annual_cost_gbp', header: 'ANNUAL COST USING 3,200 UNITS/KWH', kind: 'pounds' }
    ]
  }
};

/**
 * How the source words each payment method, mapped to the canonical
 * payment_method values in src/validate.js. Built from the phrasings that
 * actually appear in both current documents; an unrecognised phrasing is a
 * hard failure rather than a dropped or guessed payment method, because a
 * missing method silently changes what the comparison offers.
 *
 * Matching tolerates the hyphen-wrap the PDF introduces when a phrase breaks
 * across lines ("Direct Debit e- bill"), without rewriting the source text.
 */
export const PAYMENT_METHOD_PHRASES = [
  { phrase: 'Prepayment meter', method: 'prepayment' },
  { phrase: 'Direct Debit e-bill', method: 'direct_debit_ebill' },
  { phrase: 'Direct Debit postal bill', method: 'direct_debit_postal' },
  { phrase: 'Pay on receipt of e-bill', method: 'on_receipt_ebill' },
  { phrase: 'Pay on receipt of bill', method: 'on_receipt_postal' }
];

/** Longest phrase first, so "Pay on receipt of e-bill" wins over "...of bill". */
const PAYMENT_MATCHERS = [...PAYMENT_METHOD_PHRASES]
  .sort((a, b) => b.phrase.length - a.phrase.length)
  .map(({ phrase, method }) => ({
    phrase,
    method,
    pattern: new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '-\\s*'), 'i')
  }));

const normalise = (text) => text.replace(/\s+/g, ' ').trim();

/** "37.030p" -> 37.03. Anything else is malformed and must not be guessed at. */
function parsePence(raw, where) {
  const text = normalise(raw);
  const match = /^(\d+(?:\.\d+)?)\s*p$/i.exec(text);
  if (!match) {
    throw new TableAssemblyError('UNPARSEABLE_RATE', `${where}: "${text}" is not a pence value like "37.030p"`, { where, raw: text });
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new TableAssemblyError('IMPLAUSIBLE_RATE', `${where}: "${text}" is not a usable rate`, { where, raw: text });
  }
  return value;
}

/** "£1,013" -> 1013. */
function parsePounds(raw, where) {
  const text = normalise(raw);
  const match = /^£\s*([\d,]+(?:\.\d+)?)$/.exec(text);
  if (!match) {
    throw new TableAssemblyError('UNPARSEABLE_ANNUAL_COST', `${where}: "${text}" is not a pounds value like "£1,013"`, { where, raw: text });
  }
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0) {
    throw new TableAssemblyError('IMPLAUSIBLE_ANNUAL_COST', `${where}: "${text}" is not a usable annual cost`, { where, raw: text });
  }
  return value;
}

/** Groups items sharing an x position into one logical column header. */
function headerColumns(pageItems) {
  const headerItems = pageItems.filter((i) => i.fontSize === HEADER_FONT_SIZE);
  if (headerItems.length === 0) return null;

  const byX = new Map();
  for (const item of headerItems) {
    const key = [...byX.keys()].find((k) => Math.abs(k - item.x) <= X_TOLERANCE);
    if (key === undefined) byX.set(item.x, [item]);
    else byX.get(key).push(item);
  }

  return [...byX.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, items]) => ({
      x,
      label: normalise(items.sort((a, b) => b.y - a.y).map((i) => i.text).join(' '))
    }));
}

/** Splits a payment cell into the methods it prints, in printed order. */
function paymentMethodsFrom(cellText, where) {
  const text = normalise(cellText);
  if (text === '') {
    throw new TableAssemblyError('MISSING_PAYMENT_METHOD', `${where}: priced row prints no payment or billing method`, { where });
  }

  const found = [];
  let remaining = text;
  // Repeatedly take the longest recognised phrase from the front of what is
  // left, so stacked methods are recovered in order and anything unmatched
  // remains visible as residue rather than being silently ignored.
  let guard = 0;
  while (remaining.trim() !== '' && guard < 50) {
    guard += 1;
    let matched = null;
    for (const matcher of PAYMENT_MATCHERS) {
      const anchored = new RegExp('^\\s*' + matcher.pattern.source, 'i').exec(remaining);
      if (anchored) {
        matched = { method: matcher.method, phrase: matcher.phrase, consumed: anchored[0].length };
        break;
      }
    }
    if (!matched) break;
    found.push({ method: matched.method, source_phrase: matched.phrase });
    remaining = remaining.slice(matched.consumed);
  }

  if (normalise(remaining) !== '') {
    throw new TableAssemblyError(
      'UNRECOGNISED_PAYMENT_METHOD',
      `${where}: payment cell contains wording this mapping does not recognise: "${normalise(remaining)}"`,
      { where, cell: text, residue: normalise(remaining), known: PAYMENT_METHOD_PHRASES.map((p) => p.phrase) }
    );
  }
  if (found.length === 0) {
    throw new TableAssemblyError('UNRECOGNISED_PAYMENT_METHOD', `${where}: no known payment method in "${text}"`, { where, cell: text });
  }
  return found;
}

/** Collects the prose notices printed between tables (removals, scheduled changes). */
function collectNotices(items) {
  const notices = [];

  for (const heading of items.filter((i) => i.fontSize === NOTICE_HEADING_FONT_SIZE)) {
    const prose = items
      .filter((i) => i.page === heading.page && i.fontSize === PROSE_FONT_SIZE && i.y < heading.y)
      .sort((a, b) => b.y - a.y);
    notices.push({
      kind: 'section_notice',
      page: heading.page,
      heading: normalise(heading.text),
      text: normalise(prose.map((i) => i.text).join(' ')),
      // Indented lines list the affected tariffs by name.
      listed: prose.filter((i) => i.x > Math.min(...prose.map((p) => p.x)) + X_TOLERANCE).map((i) => normalise(i.text))
    });
  }

  const scheduled = items.filter((i) => i.fontSize === SCHEDULED_NOTICE_FONT_SIZE);
  const byLine = new Map();
  for (const item of scheduled) {
    const key = `${item.page}:${Math.round(item.y)}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(item);
  }
  const grouped = new Map();
  for (const [key, line] of byLine) {
    const page = Number(key.split(':')[0]);
    if (!grouped.has(page)) grouped.set(page, []);
    grouped.get(page).push({ y: line[0].y, text: line.sort((a, b) => a.x - b.x).map((i) => i.text).join('') });
  }
  for (const [page, lines] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    notices.push({
      kind: 'scheduled_change',
      page,
      heading: null,
      text: normalise(lines.sort((a, b) => b.y - a.y).map((l) => l.text).join(' ')),
      listed: []
    });
  }

  return notices;
}

/** Reads the source's own stated comparison date and VAT basis. */
function sourceStatement(items) {
  const line = items.map((i) => /Prices for\s+(\d{2})\/(\d{2})\/(\d{4})\s+including VAT of\s+(\d+)%/.exec(i.text)).find(Boolean);
  if (!line) {
    throw new TableAssemblyError(
      'MISSING_SOURCE_STATEMENT',
      'The document does not state its comparison date and VAT basis ("Prices for DD/MM/YYYY including VAT of N%")'
    );
  }
  const annualBasis = items.map((i) => /typical annual consumption of\s+([\d,]+)\s*kWh/i.exec(i.text)).find(Boolean);
  return {
    comparison_date: `${line[3]}-${line[2]}-${line[1]}`,
    vat_percent: Number(line[4]),
    vat_treatment: 'inclusive',
    typical_annual_kwh: annualBasis ? Number(annualBasis[1].replace(/,/g, '')) : null,
    statement: normalise(line.input)
  };
}

/**
 * Assembles a family's table from an extraction produced by extractTextItems.
 *
 * Returns `{ family, schema, source, suppliers, rows, notices, totals }`.
 * Throws TableAssemblyError on anything structurally unexpected: incorrect
 * headers, unparseable rates, unrecognised payment wording, a row whose
 * supplier disagrees with its section heading, or no rows at all.
 */
export function assembleTable(extraction, familyId) {
  const schema = TABLE_SCHEMAS[familyId];
  if (!schema) {
    throw new TableAssemblyError('UNKNOWN_FAMILY', `No table schema for tariff family "${familyId}"`, { familyId, known: Object.keys(TABLE_SCHEMAS) });
  }
  if (!extraction || !Array.isArray(extraction.items) || extraction.items.length === 0) {
    throw new TableAssemblyError('NO_TEXT_ITEMS', 'No extracted text items supplied');
  }

  const { items, pageCount } = extraction;
  const source = sourceStatement(items);
  const rows = [];
  const suppliers = [];
  let tablePages = 0;
  let supplierSection = null;
  let current = null;

  for (let page = 1; page <= pageCount; page += 1) {
    const pageItems = items.filter((i) => i.page === page);
    const columns = headerColumns(pageItems);
    if (!columns) continue; // an intro or footer page prints no table header

    const labels = columns.map((c) => c.label);
    if (labels.length !== schema.headers.length || labels.some((label, i) => label !== schema.headers[i])) {
      throw new TableAssemblyError(
        'UNEXPECTED_TABLE_HEADERS',
        `Page ${page} of the ${schema.label} table does not print the expected columns; the source structure has changed`,
        { page, expected: schema.headers, found: labels }
      );
    }
    tablePages += 1;

    const bands = columns.map((column, index) => ({
      label: column.label,
      left: column.x,
      right: index + 1 < columns.length ? columns[index + 1].x : Number.POSITIVE_INFINITY
    }));

    const headerBottom = Math.min(...pageItems.filter((i) => i.fontSize === HEADER_FONT_SIZE).map((i) => i.y));
    const headings = pageItems
      .filter((i) => i.fontSize === SUPPLIER_HEADING_FONT_SIZE)
      .sort((a, b) => b.y - a.y);

    const lines = [];
    for (const item of pageItems.filter((i) => i.fontSize === BODY_FONT_SIZE && i.y < headerBottom).sort((a, b) => b.y - a.y)) {
      let line = lines.find((l) => Math.abs(l.y - item.y) <= Y_TOLERANCE);
      if (!line) {
        line = { y: item.y, cells: {} };
        lines.push(line);
      }
      const band = bands.find((b) => item.x >= b.left - X_TOLERANCE && item.x < b.right - X_TOLERANCE) ?? bands[bands.length - 1];
      line.cells[band.label] = line.cells[band.label] ? `${line.cells[band.label]} ${item.text}` : item.text;
    }

    for (const line of lines.sort((a, b) => b.y - a.y)) {
      const heading = headings.find((h) => h.y > line.y);
      if (heading && normalise(heading.text) !== supplierSection) supplierSection = normalise(heading.text);
      if (supplierSection && !suppliers.includes(supplierSection)) suppliers.push(supplierSection);

      const startsRow = schema.rateFields.every((f) => line.cells[f.header]);
      if (startsRow) {
        current = {
          index: rows.length + 1,
          page,
          supplier_section: supplierSection,
          cells: {},
          lines: []
        };
        rows.push(current);
      }
      if (!current) continue; // stray text above the first priced row of the table

      current.lines.push({ y: line.y, cells: { ...line.cells } });
      for (const [label, value] of Object.entries(line.cells)) {
        current.cells[label] = current.cells[label] ? `${current.cells[label]} ${value}` : value;
      }
    }
  }

  if (tablePages === 0) {
    throw new TableAssemblyError('NO_TABLE_PAGES', `No page printed the ${schema.label} table's column headers`);
  }
  if (rows.length === 0) {
    throw new TableAssemblyError('NO_PRICED_ROWS', `The ${schema.label} table printed no priced rows`, { tablePages });
  }

  const assembled = rows.map((row) => {
    const where = `${schema.label} row ${row.index} (page ${row.page})`;
    const supplier = normalise(row.cells.SUPPLIER ?? '');
    const tariffName = normalise(row.cells['TARIFF NAME'] ?? '');

    if (supplier === '') throw new TableAssemblyError('MISSING_SUPPLIER', `${where}: no supplier printed`, { where });
    if (tariffName === '') throw new TableAssemblyError('MISSING_TARIFF_NAME', `${where}: no tariff name printed`, { where });
    if (row.supplier_section && supplier.toLowerCase() !== row.supplier_section.toLowerCase()) {
      // The supplier column repeats the section heading. A disagreement means
      // rows have been attributed to the wrong supplier section.
      throw new TableAssemblyError(
        'SUPPLIER_SECTION_MISMATCH',
        `${where}: supplier cell "${supplier}" does not match the section heading "${row.supplier_section}"`,
        { where, supplier, section: row.supplier_section }
      );
    }

    const rates = {};
    for (const field of schema.rateFields) {
      const raw = row.cells[field.header];
      rates[field.field] = field.kind === 'pence' ? parsePence(raw, `${where} ${field.header}`) : parsePounds(raw, `${where} ${field.header}`);
    }

    const paymentCell = row.cells['PAYMENT & BILLING METHOD'] ?? '';
    const payments = paymentMethodsFrom(paymentCell, where);

    return {
      index: row.index,
      page: row.page,
      supplier,
      tariff_name: tariffName,
      payment_methods: payments,
      payment_method_text: normalise(paymentCell),
      rates,
      additional_information: normalise(row.cells['ADDITIONAL INFORMATION'] ?? ''),
      printed_lines: row.lines.length
    };
  });

  const totals = {
    table_pages: tablePages,
    priced_rows: assembled.length,
    // The reconciliation's own integrity check: printed payment-method slots
    // must equal the rate rows the dataset ends up with.
    payment_method_slots: assembled.reduce((sum, row) => sum + row.payment_methods.length, 0),
    suppliers: suppliers.length
  };

  return { family: familyId, schema: { label: schema.label, headers: schema.headers }, source, suppliers, rows: assembled, notices: collectNotices(items), totals };
}

export { PdfExtractionError };
