#!/usr/bin/env node
/**
 * Captures a Consumer Council PDF's positioned text layer as a JSON fixture.
 *
 * Usage:
 *   node scripts/extract/dump-text-items.mjs <family> <pdf-path> [out-path]
 *
 * The tariff PDFs themselves are deliberately not committed — they are a
 * third-party publication, and this repository's convention is to carry
 * derived, auditable data (datasets, source-row traces, reconciliations)
 * rather than the source documents. The captured text layer is derived data
 * of exactly that kind, and it is what makes the table and mapping tests
 * deterministic and offline while still testing the real document structure.
 *
 * Regenerate a fixture when the Consumer Council's layout changes, so the
 * tests keep describing the real source rather than a remembered one.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { extractTextItems } from './pdf-text.mjs';
import { TARIFF_FAMILIES } from '../source-monitor/sources.mjs';

const [familyId, pdfPath, outPath] = process.argv.slice(2);

if (!familyId || !pdfPath) {
  console.error('Usage: node scripts/extract/dump-text-items.mjs <family> <pdf-path> [out-path]');
  process.exit(2);
}

const family = TARIFF_FAMILIES.find((f) => f.id === familyId);
if (!family) {
  console.error(`Unknown tariff family "${familyId}". Known: ${TARIFF_FAMILIES.map((f) => f.id).join(', ')}`);
  process.exit(2);
}

const buffer = readFileSync(pdfPath);
const { pageCount, fontCount, items } = extractTextItems(buffer);

// The source states its own comparison date on the final page; record what it
// says rather than the date the file happened to be fetched.
const statedDate = items
  .map((item) => /Prices for\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(item.text))
  .find(Boolean);

const fixture = {
  provenance: {
    tariff_family: family.id,
    tariff_family_label: family.label,
    landing_page_url: family.landingPageUrl,
    pdf_sha256: createHash('sha256').update(buffer).digest('hex'),
    pdf_bytes: buffer.length,
    source_comparison_date: statedDate ? `${statedDate[3]}-${statedDate[2]}-${statedDate[1]}` : null,
    captured_by: 'scripts/extract/dump-text-items.mjs',
    note:
      'Positioned text layer captured from the live Consumer Council PDF. The PDF itself is not committed; see docs/EXTRACTION.md. Raw bytes differ on every download because the endpoint regenerates the document, so pdf_sha256 is the raw hash of this particular capture, not a stable identifier — monitoring/source-state holds the stable content hash.'
  },
  pageCount,
  fontCount,
  items
};

const destination = outPath ?? `test/fixtures/consumer-council/${family.id}-text-items.json`;
writeFileSync(destination, JSON.stringify(fixture, null, 1) + '\n', 'utf8');
console.log(`${family.id}: ${items.length} items, ${pageCount} pages, stated date ${fixture.provenance.source_comparison_date} -> ${destination}`);
