import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTextItems, PdfExtractionError } from '../scripts/extract/pdf-text.mjs';

/**
 * The PDF reader is tested against synthetic PDFs built to the same shape the
 * Consumer Council's generator (dompdf 3.1.5 + CPDF) actually produces —
 * /Type0 fonts with /Identity-H encoding, an identity /ToUnicode CMap, and
 * UTF-16BE literal strings positioned one run at a time. Building them here
 * rather than committing the Council's PDFs keeps a third-party publication
 * out of the repository (see docs/EXTRACTION.md) while still exercising the
 * real encoding, and lets each failure mode be provoked deliberately.
 *
 * The real documents' own structure is covered by the extracted text-item
 * fixtures used in the table and mapping tests.
 */

/** UTF-16BE bytes as a PDF literal string, octal-escaping anything unsafe. */
function utf16Literal(text) {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    for (const byte of [(code >> 8) & 0xff, code & 0xff]) {
      if (byte < 32 || byte > 126 || byte === 0x28 || byte === 0x29 || byte === 0x5c) {
        out += '\\' + byte.toString(8).padStart(3, '0');
      } else {
        out += String.fromCharCode(byte);
      }
    }
  }
  return `(${out})`;
}

const IDENTITY_CMAP = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CMapName /Adobe-Identity-UCS def',
  '/CMapType 2 def',
  '1 begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange',
  '1 beginbfrange',
  '<0000> <FFFF> <0000>',
  'endbfrange',
  'endcmap',
  'end',
  'end'
].join('\n');

/**
 * Builds a minimal multi-page PDF. `pages` is an array of content-stream
 * strings. Options override the font dictionary and the ToUnicode CMap so
 * unsupported encodings can be provoked.
 */
function buildPdf(pages, { fontDict, cmap = IDENTITY_CMAP, omitPages = false } = {}) {
  const font =
    fontDict ??
    '/Type /Font /Subtype /Type0 /BaseFont /SUBAAB+DejaVuSans /Encoding /Identity-H /DescendantFonts [20 0 R] /ToUnicode 5 0 R';

  const objects = [];
  const pageRefs = pages.map((_, i) => `${10 + i * 2} 0 R`);

  objects.push([1, '<< /Type /Catalog /Pages 2 0 R >>']);
  objects.push([2, omitPages ? '<< /Type /Pages /Kids [] /Count 0 >>' : `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>`]);
  objects.push([3, `<< ${font} >>`]);
  objects.push([5, `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`]);

  pages.forEach((content, i) => {
    const pageNum = 10 + i * 2;
    const contentNum = pageNum + 1;
    objects.push([
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`
    ]);
    objects.push([contentNum, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  });

  let pdf = '%PDF-1.7\n';
  for (const [num, body] of objects) pdf += `${num} 0 obj\n${body}\nendobj\n`;
  pdf += 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return Buffer.from(pdf, 'latin1');
}

const run = (x, y, text, { size = 11, font = 'F1' } = {}) =>
  `BT ${x} ${y} Td /${font} ${size} Tf [${utf16Literal(text)}] TJ ET\n`;

// --- the happy path, in the generator's own shape ---------------------------

test('extracts positioned text runs with page, coordinates, font and size', () => {
  const pdf = buildPdf([run(62.362, 687.856, 'Economy 7 Price Comparison Table', { size: 22, font: 'F1' })]);
  const { pageCount, fontCount, items } = extractTextItems(pdf);

  assert.equal(pageCount, 1);
  assert.equal(fontCount, 1);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    page: 1,
    x: 62.362,
    y: 687.856,
    fontName: 'F1',
    fontSize: 22,
    text: 'Economy 7 Price Comparison Table'
  });
});

test('pages are numbered in document order', () => {
  const pdf = buildPdf([run(10, 700, 'first page'), run(10, 700, 'second page'), run(10, 700, 'third page')]);
  const { pageCount, items } = extractTextItems(pdf);
  assert.equal(pageCount, 3);
  assert.deepEqual(
    items.map((i) => [i.page, i.text]),
    [[1, 'first page'], [2, 'second page'], [3, 'third page']]
  );
});

test('decodes characters that require escaping, including the ones the source actually uses', () => {
  // Parentheses, a backslash, a pound sign and a right single quote all appear
  // in the real ADDITIONAL INFORMATION column.
  const text = "£40 welcome credit (new customers only) — Budget Energy’s \\ tariff";
  const { items } = extractTextItems(buildPdf([run(10, 700, text)]));
  assert.equal(items[0].text, text);
});

test('multiple runs on one page keep their own positions', () => {
  const content = run(67.1, 673.7, 'Budget') + run(260.0, 673.7, '37.030p') + run(67.1, 663.0, 'Energy');
  const { items } = extractTextItems(buildPdf([content]));
  assert.deepEqual(
    items.map((i) => [i.x, i.y, i.text]),
    [[67.1, 673.7, 'Budget'], [260.0, 673.7, '37.030p'], [67.1, 663.0, 'Energy']]
  );
});

// --- operators the current generator does not use, but a future one might ---

test('Tm positioning is honoured, not ignored', () => {
  const content = `BT /F1 11 Tf 1 0 0 1 123.4 567.8 Tm [${utf16Literal('placed by Tm')}] TJ ET\n`;
  const { items } = extractTextItems(buildPdf([content]));
  assert.deepEqual([items[0].x, items[0].y, items[0].text], [123.4, 567.8, 'placed by Tm']);
});

test('TD and T* advance the line by the leading rather than stacking at one point', () => {
  const content =
    `BT 50 700 Td /F1 11 Tf 14 TL [${utf16Literal('first line')}] TJ T* [${utf16Literal('second line')}] TJ ET\n`;
  const { items } = extractTextItems(buildPdf([content]));
  assert.deepEqual(
    items.map((i) => [i.y, i.text]),
    [[700, 'first line'], [686, 'second line']]
  );
});

test('two Td operations inside one text block are two separate positioned runs', () => {
  // The real PDFs use one Td per BT block. If that ever changes, the runs must
  // not be merged into a single mis-positioned cell.
  const content =
    `BT /F1 11 Tf 100 700 Td [${utf16Literal('cell one')}] TJ 50 -20 Td [${utf16Literal('cell two')}] TJ ET\n`;
  const { items } = extractTextItems(buildPdf([content]));
  assert.deepEqual(
    items.map((i) => [i.x, i.y, i.text]),
    [[100, 700, 'cell one'], [150, 680, 'cell two']]
  );
});

test('kerning numbers inside a TJ array are ignored, not read as text', () => {
  const content = `BT 50 700 Td /F1 11 Tf [${utf16Literal('Keypad')} -25 ${utf16Literal(' Economy 7')}] TJ ET\n`;
  const { items } = extractTextItems(buildPdf([content]));
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'Keypad Economy 7');
});

test('a Tj string shows text as well as a TJ array', () => {
  const content = `BT 50 700 Td /F1 11 Tf ${utf16Literal('shown by Tj')} Tj ET\n`;
  const { items } = extractTextItems(buildPdf([content]));
  assert.equal(items[0].text, 'shown by Tj');
});

// --- failure modes: wrong output is worse than no output --------------------

test('input that is not a PDF is refused', () => {
  assert.throws(
    () => extractTextItems(Buffer.from('<html>not a pdf</html>')),
    (err) => err instanceof PdfExtractionError && err.code === 'NOT_A_PDF'
  );
});

test('empty input is refused', () => {
  assert.throws(
    () => extractTextItems(Buffer.alloc(0)),
    (err) => err instanceof PdfExtractionError && err.code === 'EMPTY_INPUT'
  );
});

test('a font that is not /Type0 /Identity-H is refused rather than mis-decoded', () => {
  // A simple font's single-byte codes would silently decode to wrong
  // characters under UTF-16BE, producing plausible-looking nonsense.
  const pdf = buildPdf([run(10, 700, 'text')], {
    fontDict: '/Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding'
  });
  assert.throws(
    () => extractTextItems(pdf),
    (err) => err instanceof PdfExtractionError && err.code === 'UNSUPPORTED_FONT_ENCODING'
  );
});

test('a /Type0 font without a /ToUnicode CMap is refused', () => {
  const pdf = buildPdf([run(10, 700, 'text')], {
    fontDict: '/Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [20 0 R]'
  });
  assert.throws(
    () => extractTextItems(pdf),
    (err) => err instanceof PdfExtractionError && err.code === 'FONT_WITHOUT_TOUNICODE'
  );
});

test('a non-identity /ToUnicode CMap is refused rather than assumed to be identity', () => {
  const remapped = IDENTITY_CMAP.replace('<0000> <FFFF> <0000>', '<0000> <00FF> <0041>');
  assert.throws(
    () => extractTextItems(buildPdf([run(10, 700, 'text')], { cmap: remapped })),
    (err) => err instanceof PdfExtractionError && err.code === 'NON_IDENTITY_TOUNICODE'
  );
});

test('a PDF with no pages is refused', () => {
  assert.throws(
    () => extractTextItems(buildPdf([run(10, 700, 'text')], { omitPages: true })),
    (err) => err instanceof PdfExtractionError && err.code === 'NO_PAGES'
  );
});

test('a PDF whose pages carry no text is refused rather than returning nothing useful', () => {
  const drawingOnly = 'q 1 0 0 RG 10 10 m 100 100 l S Q\n';
  assert.throws(
    () => extractTextItems(buildPdf([drawingOnly])),
    (err) => err instanceof PdfExtractionError && err.code === 'NO_TEXT'
  );
});

test('extraction is deterministic for identical input', () => {
  const pdf = buildPdf([run(67.1, 673.7, 'Budget') + run(260.0, 673.7, '37.030p')]);
  assert.equal(JSON.stringify(extractTextItems(pdf)), JSON.stringify(extractTextItems(pdf)));
});
