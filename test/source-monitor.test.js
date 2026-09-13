import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { selectCurrentPdf, findCandidatePdfLinks, assertIsPdf, SourceDiscoveryError } from '../scripts/source-monitor/discover.mjs';
import { TARIFF_FAMILIES } from '../scripts/source-monitor/sources.mjs';
import { sha256Hex, stableContentBytes } from '../scripts/source-monitor/hash.mjs';
import { buildStateRecord, compareState } from '../scripts/source-monitor/state.mjs';
import { fetchText, SourceFetchError } from '../scripts/source-monitor/fetch-utils.mjs';

const fixturesRoot = fileURLToPath(new URL('./fixtures/source-monitor/', import.meta.url));
const fixture = (name) => readFileSync(fixturesRoot + name, 'utf8');

const economy7Family = TARIFF_FAMILIES.find((f) => f.id === 'economy7');
const standardFamily = TARIFF_FAMILIES.find((f) => f.id === 'standard');

const BASE_URL = 'https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/economy-7';

// --- discovery from realistic-shaped landing pages --------------------------

test('discovers the current Economy 7 PDF from its landing page', () => {
  const html = fixture('economy7-landing.html');
  const candidate = selectCurrentPdf(html, BASE_URL, economy7Family);
  assert.match(candidate.url, /Economy%207.*12%20September%202026\.pdf$/);
  assert.match(candidate.text, /Economy 7 Price Comparison Table \(12 September 2026\)/);
});

test('discovers the current standard (24-hour) PDF from its own landing page, ignoring the Economy 7 link on the same page', () => {
  const html = fixture('standard-landing.html');
  const candidate = selectCurrentPdf(html, BASE_URL, standardFamily);
  assert.match(candidate.url, /Electricity%20Price%20Comparison%20Table.*12%20September%202026\.pdf$/);
  assert.doesNotMatch(candidate.url, /Economy/);
});

test('archived/historical PDFs are not selected when a current PDF is identifiable', () => {
  const html = fixture('economy7-landing.html');
  const candidates = findCandidatePdfLinks(html, BASE_URL, economy7Family);
  assert.equal(candidates.length, 1);
  assert.doesNotMatch(candidates[0].url, /August|July/);
});

// --- the real live page shape (issue #16 commissioning finding) --------------
//
// The actual Consumer Council site does not link a literal .pdf URL at all:
// it renders a "View PDF" link to a Drupal print endpoint
// (/print/pdf/node/<id>), verified live 2026-09-13. This must be discovered
// without assuming a .pdf file extension and without the link text
// mentioning the family name.

test('discovers a "View PDF" link to a non-.pdf print endpoint, matching the real live page', () => {
  const html = fixture('economy7-landing-real-shape.html');
  const candidate = selectCurrentPdf(html, BASE_URL, economy7Family);
  assert.equal(candidate.url, 'https://www.consumercouncil.org.uk/print/pdf/node/13469');
  assert.equal(candidate.text, 'View PDF');
});

test('a "View PDF" link is found among many unrelated navigation/footer links, not just in isolation', () => {
  const html = fixture('economy7-landing-real-shape.html');
  const candidates = findCandidatePdfLinks(html, BASE_URL, economy7Family);
  assert.equal(candidates.length, 1);
});

// --- failure modes -----------------------------------------------------------

test('no PDF link on the page fails clearly rather than guessing', () => {
  const html = `<html><body><h1>Economy 7</h1><p>No documents currently linked.</p></body></html>`;
  assert.throws(
    () => selectCurrentPdf(html, BASE_URL, economy7Family),
    (err) => err instanceof SourceDiscoveryError && err.code === 'NO_PDF_FOUND'
  );
});

test('two equally plausible current PDF candidates fail as ambiguous', () => {
  const html = `
    <html><body>
      <h1>Economy 7</h1>
      <a href="/files/economy-7-table-a.pdf">Economy 7 Price Comparison Table (version A)</a>
      <a href="/files/economy-7-table-b.pdf">Economy 7 Price Comparison Table (version B)</a>
    </body></html>`;
  assert.throws(
    () => selectCurrentPdf(html, BASE_URL, economy7Family),
    (err) => err instanceof SourceDiscoveryError && err.code === 'AMBIGUOUS_CANDIDATES'
  );
});

test('two "View PDF"-style links on one page fail as ambiguous, not as pick-the-first', () => {
  const html = `
    <html><body>
      <h1>Economy 7</h1>
      <a href="/print/pdf/node/13469">View PDF</a>
      <a href="/print/pdf/node/99999">View PDF</a>
    </body></html>`;
  assert.throws(
    () => selectCurrentPdf(html, BASE_URL, economy7Family),
    (err) => err instanceof SourceDiscoveryError && err.code === 'AMBIGUOUS_CANDIDATES'
  );
});

test('a non-PDF candidate link is rejected rather than treated as the current document', () => {
  const html = `<html><body><h1>Economy 7</h1><a href="/files/economy-7-table.docx">Economy 7 Price Comparison Table</a></body></html>`;
  assert.throws(
    () => selectCurrentPdf(html, BASE_URL, economy7Family),
    (err) => err instanceof SourceDiscoveryError && err.code === 'NO_PDF_FOUND'
  );
});

test('a downloaded document without a PDF file signature is rejected', () => {
  const notActuallyAPdf = Buffer.from('<html>this is not a pdf</html>');
  assert.throws(
    () => assertIsPdf(notActuallyAPdf, 'https://example.org/table.pdf'),
    (err) => err instanceof SourceDiscoveryError && err.code === 'NOT_A_PDF'
  );
});

test('a genuine PDF signature is accepted', () => {
  const realPdfLike = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('...fake body...')]);
  assert.doesNotThrow(() => assertIsPdf(realPdfLike, 'https://example.org/table.pdf'));
});

test('malformed/unexpected HTML with no recognisable anchors fails safely', () => {
  const html = `not html at all, just plain text with no markup`;
  assert.throws(
    () => selectCurrentPdf(html, BASE_URL, economy7Family),
    (err) => err instanceof SourceDiscoveryError && err.code === 'NO_PDF_FOUND'
  );
});

test('empty landing page content fails safely', () => {
  assert.throws(
    () => selectCurrentPdf('', BASE_URL, economy7Family),
    (err) => err instanceof SourceDiscoveryError && err.code === 'EMPTY_PAGE'
  );
});

// --- stable hashing against dynamically-regenerated PDFs (issue #16) ---------
//
// Live commissioning found the Consumer Council's print/pdf endpoint
// regenerates the PDF fresh on every request: fetching the identical,
// unchanged document twice a few seconds apart produced different raw bytes
// in exactly three places (/CreationDate, /ModDate, and the trailer's /ID
// pair), with everything else — including the whole rendered table —
// byte-for-byte identical. Hashing raw bytes would report "changed" on every
// run regardless of real content. These fixtures reproduce that exact shape.

const pdfWithMetadata = (creationDate, modDate, id) =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj\n<<\n>>\nendobj\n5 0 obj\n<<\n/CreationDate (${creationDate})\n/ModDate (${modDate})\n/Title (Electricity Price Comparison Table)\n>>\nendobj\ntrailer\n<<\n/Root 1 0 R\n/Info 5 0 R\n/ID[<${id}><${id}>]\n>>\nstartxref\n0\n%%EOF`,
    'latin1'
  );

test('two fetches of the identical document with only timestamp/ID differences hash the same', () => {
  const fetch1 = pdfWithMetadata("D:20260913143331+01'00'", "D:20260913143331+01'00'", 'dcdfd63b24697291542ebc68e5d4daea');
  const fetch2 = pdfWithMetadata("D:20260913143333+01'00'", "D:20260913143333+01'00'", '6a938de6ac85b403b18cce042f1cccce');
  assert.equal(sha256Hex(stableContentBytes(fetch1)), sha256Hex(stableContentBytes(fetch2)));
  // sanity check: the raw bytes actually do differ, so this isn't a no-op fixture
  assert.notEqual(sha256Hex(fetch1), sha256Hex(fetch2));
});

test('a genuine content change (not just timestamps) still produces a different stable hash', () => {
  const original = pdfWithMetadata("D:20260913143331+01'00'", "D:20260913143331+01'00'", 'dcdfd63b24697291542ebc68e5d4daea');
  const editedTitle = Buffer.from(
    original.toString('latin1').replace('Electricity Price Comparison Table', 'Electricity Price Comparison Table V2'),
    'latin1'
  );
  assert.notEqual(sha256Hex(stableContentBytes(original)), sha256Hex(stableContentBytes(editedTitle)));
});

// --- change detection ---------------------------------------------------------

function record(overrides = {}) {
  return buildStateRecord({
    family: economy7Family,
    candidate: { url: 'https://example.org/economy-7-2026-09.pdf', text: 'Economy 7 Price Comparison Table' },
    hash: sha256Hex(Buffer.from('pdf-content-a')),
    length: 123,
    headers: {},
    checkedAt: '2026-09-12T09:00:00.000Z',
    ...overrides
  });
}

test('same URL and same content hash is unchanged', () => {
  const previous = record();
  const current = record({ checkedAt: '2026-10-12T09:00:00.000Z' });
  const result = compareState(previous, current);
  assert.deepEqual(result, { status: 'unchanged', reasons: [] });
});

test('same URL with a different content hash is detected as a content change', () => {
  const previous = record();
  const current = record({ hash: sha256Hex(Buffer.from('pdf-content-b')) });
  const result = compareState(previous, current);
  assert.equal(result.status, 'changed');
  assert.deepEqual(result.reasons, ['content']);
});

test('a different PDF URL is detected as a URL change even with unchanged content', () => {
  const previous = record();
  const current = buildStateRecord({
    family: economy7Family,
    candidate: { url: 'https://example.org/economy-7-2026-10.pdf', text: 'Economy 7 Price Comparison Table' },
    hash: sha256Hex(Buffer.from('pdf-content-a')),
    length: 123,
    headers: {},
    checkedAt: '2026-10-12T09:00:00.000Z'
  });
  const result = compareState(previous, current);
  assert.equal(result.status, 'changed');
  assert.deepEqual(result.reasons, ['url']);
});

test('a different URL and different content are both reported as changed', () => {
  const previous = record();
  const current = buildStateRecord({
    family: economy7Family,
    candidate: { url: 'https://example.org/economy-7-2026-10.pdf', text: 'Economy 7 Price Comparison Table' },
    hash: sha256Hex(Buffer.from('pdf-content-b')),
    length: 456,
    headers: {},
    checkedAt: '2026-10-12T09:00:00.000Z'
  });
  const result = compareState(previous, current);
  assert.equal(result.status, 'changed');
  assert.deepEqual(result.reasons.sort(), ['content', 'url']);
});

test('no previous state is reported as a new source', () => {
  const result = compareState(null, record());
  assert.deepEqual(result, { status: 'new', reasons: [] });
});

// --- provenance and independence of the two families --------------------------

test('the state record carries sufficient provenance for future extraction', () => {
  const rec = record();
  for (const field of [
    'tariff_family',
    'landing_page_url',
    'pdf_url',
    'discovered_link_text',
    'content_sha256',
    'content_length_bytes',
    'checked_at'
  ]) {
    assert.ok(field in rec, `expected state record to include "${field}"`);
    assert.notEqual(rec[field], undefined);
  }
});

test('the two tariff families are configured independently with distinct landing pages', () => {
  assert.equal(TARIFF_FAMILIES.length, 2);
  const urls = TARIFF_FAMILIES.map((f) => f.landingPageUrl);
  assert.equal(new Set(urls).size, urls.length, 'landing page URLs must be distinct per family');

  const economy7Candidate = selectCurrentPdf(fixture('economy7-landing.html'), BASE_URL, economy7Family);
  const standardCandidate = selectCurrentPdf(fixture('standard-landing.html'), BASE_URL, standardFamily);
  assert.notEqual(economy7Candidate.url, standardCandidate.url);
});

// --- outbound requests identify themselves (issue #16 commissioning finding) --

test('requests send a non-empty User-Agent, so a public site is not treated as an anonymous/bot client', async () => {
  let receivedHeaders;
  const server = createServer((req, res) => {
    receivedHeaders = req.headers;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>ok</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await fetchText(`http://127.0.0.1:${port}/`, 5000);
    assert.ok(receivedHeaders['user-agent'], 'expected a User-Agent header to be sent');
    assert.ok(receivedHeaders['user-agent'].length > 0);
  } finally {
    server.close();
  }
});

test('a non-2xx response is still reported as a clear SourceFetchError with the HTTP status', async () => {
  const server = createServer((req, res) => {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await assert.rejects(
      () => fetchText(`http://127.0.0.1:${port}/`, 5000),
      (err) => err instanceof SourceFetchError && err.details.status === 403
    );
  } finally {
    server.close();
  }
});
