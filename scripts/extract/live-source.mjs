/**
 * Discovers and downloads one tariff family's current PDF from the live site,
 * the same way the source monitor does.
 *
 * The fetchers are passed in so this — the one path that touches the network
 * — can be tested offline. It was untested until the first live run found it
 * passing fetchBinary's { buffer, headers } result, rather than the buffer,
 * to the %PDF- signature check, so every download was refused as "not a PDF"
 * however good it was.
 */

import { selectCurrentPdf, assertIsPdf } from '../source-monitor/discover.mjs';
import { sha256Hex, stableContentBytes } from '../source-monitor/hash.mjs';

export async function fetchCurrentPdf(family, { fetchText, fetchBinary, timeoutMs, now = () => new Date() }) {
  const html = await fetchText(family.landingPageUrl, timeoutMs);
  const pdfUrl = selectCurrentPdf(html, family.landingPageUrl, family).url;
  const { buffer, headers } = await fetchBinary(pdfUrl, timeoutMs);
  assertIsPdf(buffer, pdfUrl);
  return {
    buffer,
    pdfUrl,
    // Where the run's data came from, recorded in the published provenance:
    // the discovered URL, when it was fetched, and the same stable content
    // hash the source monitor records, so a published dataset can be matched
    // to the monitor's record of that document.
    provenance: {
      landing_page_url: family.landingPageUrl,
      pdf_url: pdfUrl,
      fetched_at: now().toISOString(),
      content_type: headers?.contentType ?? null,
      pdf_bytes: buffer.length,
      stable_content_sha256: sha256Hex(stableContentBytes(buffer))
    }
  };
}
