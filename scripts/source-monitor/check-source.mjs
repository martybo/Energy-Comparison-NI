#!/usr/bin/env node
/**
 * Checks each Consumer Council tariff-family landing page for its current
 * PDF, downloads it, hashes it, and compares that against the last recorded
 * state committed under monitoring/source-state/.
 *
 * Usage: node scripts/source-monitor/check-source.mjs [familyId ...]
 * With no arguments, all configured tariff families are checked.
 *
 * Exit code is non-zero if any family could not be safely checked (fetch
 * failure, ambiguous/missing PDF, non-PDF document). A per-family failure
 * does not stop other families from being checked.
 *
 * Writes GitHub Actions outputs (when GITHUB_OUTPUT is set) and downloads
 * changed/new PDFs to monitoring/downloads/ for the workflow to upload as an
 * artifact. Never touches data/ or any tariff dataset.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TARIFF_FAMILIES } from './sources.mjs';
import { fetchText, fetchBinary, SourceFetchError } from './fetch-utils.mjs';
import { selectCurrentPdf, assertIsPdf, extractLinks, SourceDiscoveryError } from './discover.mjs';
import { sha256Hex, stableContentBytes } from './hash.mjs';
import { readState, buildStateRecord, compareState, writeStateIfChanged } from './state.mjs';

const LANDING_PAGE_TIMEOUT_MS = 20_000;
const PDF_TIMEOUT_MS = 30_000;

const DOWNLOADS_DIR = fileURLToPath(new URL('../../monitoring/downloads/', import.meta.url));

async function checkFamily(family) {
  const checkedAt = new Date().toISOString();

  const html = await fetchText(family.landingPageUrl, LANDING_PAGE_TIMEOUT_MS);

  let candidate;
  try {
    candidate = selectCurrentPdf(html, family.landingPageUrl, family);
  } catch (err) {
    if (err instanceof SourceDiscoveryError) {
      // Discovery failures are exactly the case a human needs to see the real
      // page for, to correct sources.mjs's patterns rather than guess blindly.
      // Saved to the artifact for full inspection, and also summarised
      // straight into the log (every .pdf-ending link found anywhere on the
      // page, regardless of family filtering), since the artifact itself may
      // not always be reachable.
      mkdirSync(DOWNLOADS_DIR, { recursive: true });
      writeFileSync(join(DOWNLOADS_DIR, `${family.id}-landing-page.html`), html, 'utf8');

      const allLinks = extractLinks(html, family.landingPageUrl);
      // Broad match: anything with "pdf" in the URL or link text anywhere,
      // not just a literal .pdf file extension — the previous version of
      // this diagnostic only checked the extension, which is why it missed
      // a Drupal print/pdf endpoint (e.g. /print/pdf/node/13468) reported
      // from manual inspection of the live site.
      const pdfLike = allLinks.filter((l) => /pdf/i.test(l.url) || /pdf/i.test(l.text));
      console.error(`[${family.id}] DEBUG: ${allLinks.length} total link(s), ${pdfLike.length} pdf-like link(s) on the page:`);
      for (const link of pdfLike) {
        console.error(`[${family.id}] DEBUG:   pdf-like: "${link.text}" -> ${link.url}`);
      }
      console.error(`[${family.id}] DEBUG: first 40 links on the page (for context):`);
      for (const link of allLinks.slice(0, 40)) {
        console.error(`[${family.id}] DEBUG:   "${link.text}" -> ${link.url}`);
      }
      const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      );
      console.error(`[${family.id}] DEBUG: headings on page: ${JSON.stringify(headings)}`);
    }
    throw err;
  }

  const { buffer, headers } = await fetchBinary(candidate.url, PDF_TIMEOUT_MS);
  assertIsPdf(buffer, candidate.url);

  // Hash a version with volatile regeneration timestamps/IDs masked, not the
  // raw bytes — see stableContentBytes() for why. The real, unmodified
  // `buffer` is still what gets saved to disk/artifact and signature-checked.
  const hash = sha256Hex(stableContentBytes(buffer));
  const current = buildStateRecord({ family, candidate, hash, length: buffer.length, headers, checkedAt });
  const previous = readState(family.id);
  const comparison = compareState(previous, current);

  let downloadPath = null;
  if (comparison.status !== 'unchanged') {
    mkdirSync(DOWNLOADS_DIR, { recursive: true });
    downloadPath = join(DOWNLOADS_DIR, `${family.id}.pdf`);
    writeFileSync(downloadPath, buffer);
    writeStateIfChanged(family.id, previous, current);
  }

  return { family, status: comparison.status, reasons: comparison.reasons, previous, current, downloadPath };
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, `${name}=${value}\n`);
}

function summarize(result) {
  const { family, status, reasons, current } = result;
  const lines = [`## ${family.label} (${family.id})`, ''];
  lines.push(`- Status: **${status}**${reasons.length ? ` (${reasons.join(', ')} changed)` : ''}`);
  lines.push(`- Landing page: ${family.landingPageUrl}`);
  lines.push(`- Discovered PDF: ${current.pdf_url}`);
  lines.push(`- Link text: "${current.discovered_link_text}"`);
  lines.push(`- SHA-256: \`${current.content_sha256}\``);
  lines.push(`- Size: ${current.content_length_bytes} bytes`);
  lines.push(`- Checked at: ${current.checked_at}`);
  return lines.join('\n');
}

function summarizeFailure(family, err) {
  return [`## ${family.label} (${family.id})`, '', `- Status: **failed**`, `- Error: ${err.message}`].join('\n');
}

async function main() {
  const requestedIds = process.argv.slice(2);
  const families = requestedIds.length > 0 ? TARIFF_FAMILIES.filter((f) => requestedIds.includes(f.id)) : TARIFF_FAMILIES;

  if (families.length === 0) {
    console.error(`No matching tariff family for: ${requestedIds.join(', ')}`);
    process.exit(2);
  }

  const summaries = [];
  let anyChanged = false;
  let anyFailed = false;

  for (const family of families) {
    try {
      const result = await checkFamily(family);
      summaries.push(summarize(result));
      setOutput(`${family.id}_status`, result.status);
      if (result.status !== 'unchanged') anyChanged = true;
      console.log(`[${family.id}] ${result.status}${result.reasons.length ? ` (${result.reasons.join(', ')})` : ''} — ${result.current.pdf_url}`);
    } catch (err) {
      anyFailed = true;
      setOutput(`${family.id}_status`, 'failed');
      const isKnown = err instanceof SourceDiscoveryError || err instanceof SourceFetchError;
      const detail = isKnown ? err.message : `Unexpected error: ${err.stack ?? err.message}`;
      summaries.push(summarizeFailure(family, err));
      console.error(`[${family.id}] FAILED: ${detail}`);
    }
  }

  setOutput('any_changed', String(anyChanged));
  setOutput('any_failed', String(anyFailed));

  mkdirSync(DOWNLOADS_DIR, { recursive: true });
  writeFileSync(join(DOWNLOADS_DIR, 'summary.md'), summaries.join('\n\n') + '\n', 'utf8');

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, summaries.join('\n\n') + '\n');

  if (anyFailed) {
    console.error('\nOne or more tariff-family source checks failed. See errors above.');
    process.exit(1);
  }
}

main();
