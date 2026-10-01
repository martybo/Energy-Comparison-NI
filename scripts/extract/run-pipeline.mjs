#!/usr/bin/env node
/**
 * Runs the whole extraction offline, from a captured text layer or a PDF on
 * disk, and writes the candidate dataset and reconciliation to a directory.
 *
 * Usage:
 *   node scripts/extract/run-pipeline.mjs --out <dir> [--pdf <family>=<path> ...]
 *
 * With no --pdf, each family is read from its committed text-item fixture, so
 * the pipeline is reproducible without network access or the source documents.
 *
 * Nothing under data/ is read for writing or modified: the published dataset is
 * read only to compare against and to supply the two domain-knowledge fields
 * the source does not state.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractTextItems } from './pdf-text.mjs';
import { assembleTable } from './table.mjs';
import { mapToCanonical } from './map-canonical.mjs';
import { reconcile, renderReconciliation } from './reconcile.mjs';
import { validateDataset } from '../../src/validate.js';

/** Each family's published dataset, read only as a comparison and for Tier 2. */
const FAMILIES = [
  { id: 'economy7', published: 'data/tariffs-2026-09-12.json', fixture: 'test/fixtures/consumer-council/economy7-text-items.json' },
  { id: 'standard', published: 'data/tariffs-standard-2026-09-12.json', fixture: 'test/fixtures/consumer-council/standard-text-items.json' }
];

function parseArgs(argv) {
  const args = { out: null, pdfs: new Map() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--pdf') {
      const [family, path] = (argv[++i] ?? '').split('=');
      if (!family || !path) throw new Error('--pdf expects <family>=<path>');
      args.pdfs.set(family, path);
    } else throw new Error(`Unknown argument "${argv[i]}"`);
  }
  if (!args.out) throw new Error('--out <dir> is required');
  return args;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

let openGates = 0;

for (const family of FAMILIES) {
  const pdfPath = args.pdfs.get(family.id);
  const extraction = pdfPath
    ? extractTextItems(readFileSync(pdfPath))
    : JSON.parse(readFileSync(family.fixture, 'utf8'));

  const table = assembleTable(extraction, family.id);
  const published = JSON.parse(readFileSync(family.published, 'utf8'));
  const candidate = mapToCanonical({ table, previous: { dataset: published, label: family.published } });

  // The validator the application itself uses. A candidate that does not pass
  // it is never written as a dataset, and the validator is never relaxed to
  // let an extraction through.
  const validation = validateDataset(candidate.dataset);
  const invalid = validation.invalid ?? [];
  if (invalid.length > 0) {
    console.error(`${family.id}: ${invalid.length} record(s) rejected by src/validate.js:`);
    for (const record of invalid) console.error(`  - ${JSON.stringify(record).slice(0, 400)}`);
    process.exitCode = 1;
    continue;
  }

  const report = reconcile({ candidate, published, publishedLabel: family.published });
  openGates += report.gates.length;

  const stem = family.id === 'economy7' ? 'tariffs' : 'tariffs-standard';
  const date = candidate.dataset.dataset.effective_from;
  writeFileSync(join(args.out, `${stem}-${date}.json`), JSON.stringify(candidate.dataset, null, 2) + '\n', 'utf8');
  writeFileSync(join(args.out, `source-rows-${family.id}-${date}.json`), JSON.stringify(candidate.source_row_trace) + '\n', 'utf8');
  writeFileSync(join(args.out, `provenance-${family.id}-${date}.json`), JSON.stringify({
    field_provenance: candidate.field_provenance,
    carry_forward_audit: candidate.carry_forward_audit,
    repeated_slots: candidate.repeated_slots,
    review_required: candidate.review_required
  }, null, 2) + '\n', 'utf8');
  writeFileSync(join(args.out, `reconciliation-${family.id}-${date}.md`), renderReconciliation(report), 'utf8');

  const a = report.slot_accounting;
  console.log(
    `${family.id}: ${report.totals.source_rows} rows, ${a.printed_slots} printed slots -> ${a.mapped_rate_rows} rates ` +
      `+ ${a.page_break_repeats} repeats + ${a.slots_in_unresolved_rows} awaiting decision (${a.balanced ? 'balanced' : 'UNBALANCED'}); ` +
      `${report.totals.products} products; ${report.products.added.length} added, ${report.products.removed.length} gone, ` +
      `${report.products.changed.length} changed, ${report.products.unchanged_count} unchanged; ${report.gates.length} gate(s)`
  );
}

if (openGates > 0) {
  console.log(`\n${openGates} gate(s) open. The candidate datasets are written for review but must not be published as they stand.`);
}
