import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import { fetchCurrentPdf } from '../scripts/extract/live-source.mjs';
import { fetchText, fetchBinary, SourceFetchError } from '../scripts/source-monitor/fetch-utils.mjs';
import { SourceDiscoveryError } from '../scripts/source-monitor/discover.mjs';
import { sha256Hex, stableContentBytes } from '../scripts/source-monitor/hash.mjs';
import { TARIFF_FAMILIES } from '../scripts/source-monitor/sources.mjs';

/**
 * The live fetch is the one path the rest of the suite never exercises, and
 * the first live run found a bug in it: fetchBinary's { buffer, headers }
 * result was passed to the %PDF- check instead of the buffer, so every real
 * download was refused as "not a PDF". These tests drive the real fetchers
 * against a local server, so the seam between them is what is tested.
 */

const LANDING = readFileSync('test/fixtures/source-monitor/economy7-landing-real-shape.html', 'utf8');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');

/** Serves the real-shape landing page at /landing and `pdfBody` wherever its View PDF link points. */
async function site({ pdfBody = PDF, pdfType = 'application/pdf', landingStatus = 200 } = {}) {
  const server = createServer((req, res) => {
    if (req.url === '/landing') {
      res.writeHead(landingStatus, { 'content-type': 'text/html' });
      res.end(landingStatus === 200 ? LANDING : 'Forbidden');
      return;
    }
    if (req.url.startsWith('/print/pdf/')) {
      res.writeHead(200, { 'content-type': pdfType });
      res.end(pdfBody);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const family = { ...TARIFF_FAMILIES.find((f) => f.id === 'economy7'), landingPageUrl: `${base}/landing` };
  return { family, close: () => new Promise((resolve) => server.close(resolve)) };
}

const real = { fetchText, fetchBinary, timeoutMs: 5000, now: () => new Date('2026-10-01T21:00:00Z') };

test('with the real fetchers, a real PDF download is accepted and its bytes returned', async () => {
  const { family, close } = await site();
  try {
    const result = await fetchCurrentPdf(family, real);
    assert.ok(Buffer.isBuffer(result.buffer), 'the PDF bytes, not the fetcher\'s result object');
    assert.deepEqual(result.buffer, PDF);
    assert.match(result.pdfUrl, /\/print\/pdf\/node\/\d+$/);
  } finally {
    await close();
  }
});

test('the live fetch records where the data came from, hashed as the monitor hashes it', async () => {
  const { family, close } = await site();
  try {
    const { provenance, pdfUrl } = await fetchCurrentPdf(family, real);
    assert.equal(provenance.landing_page_url, family.landingPageUrl);
    assert.equal(provenance.pdf_url, pdfUrl);
    assert.equal(provenance.fetched_at, '2026-10-01T21:00:00.000Z');
    assert.equal(provenance.content_type, 'application/pdf');
    assert.equal(provenance.pdf_bytes, PDF.length);
    assert.equal(provenance.stable_content_sha256, sha256Hex(stableContentBytes(PDF)));
  } finally {
    await close();
  }
});

test('a download that is not a PDF is still refused', async () => {
  // A WAF challenge page served with 200 must not be read as tariff data.
  const { family, close } = await site({ pdfBody: Buffer.from('<html>Please verify you are human</html>'), pdfType: 'text/html' });
  try {
    await assert.rejects(() => fetchCurrentPdf(family, real), (err) => err instanceof SourceDiscoveryError && err.code === 'NOT_A_PDF');
  } finally {
    await close();
  }
});

test('a refused landing page is reported as a fetch failure', async () => {
  const { family, close } = await site({ landingStatus: 403 });
  try {
    await assert.rejects(() => fetchCurrentPdf(family, real), (err) => err instanceof SourceFetchError && /HTTP 403/.test(err.message));
  } finally {
    await close();
  }
});
