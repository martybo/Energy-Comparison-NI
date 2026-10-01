#!/usr/bin/env node
/**
 * Runs the whole extraction and says what it concluded.
 *
 * Usage:
 *   node scripts/extract/run-pipeline.mjs --out <dir> [--live] [--pdf <family>=<path>]
 *
 * With no source option each family is read from its committed text-item
 * fixture, so the pipeline is reproducible offline and in tests. `--live`
 * discovers and downloads the current PDFs the same way the source monitor
 * does; `--pdf` reads one from disk.
 *
 * What it writes depends on what it concluded, and only a clean change is
 * allowed to produce a dataset. See scripts/extract/outcomes.mjs. Nothing
 * under data/, src/ or index.html is modified: the published datasets are read
 * only to compare against and to supply the two domain-knowledge fields the
 * source does not state. The pointer that publishes a dataset is written into
 * the candidate directory for a reviewer to merge, never into data/ here.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractTextItems, PdfExtractionError } from './pdf-text.mjs';
import { assembleTable, TableAssemblyError } from './table.mjs';
import { mapToCanonical, MappingError } from './map-canonical.mjs';
import { reconcile, renderReconciliation } from './reconcile.mjs';
import { OUTCOMES, classifyFamily, classifyRun, failedFamily } from './outcomes.mjs';
import { TARIFF_FAMILIES } from '../source-monitor/sources.mjs';
import { fetchText, fetchBinary, SourceFetchError } from '../source-monitor/fetch-utils.mjs';
import { selectCurrentPdf, assertIsPdf, SourceDiscoveryError } from '../source-monitor/discover.mjs';
import { validateDataset } from '../../src/validate.js';

/** Each family's published dataset and the pointer that selects it. */
const FAMILIES = {
  economy7: {
    published: 'data/tariffs-2026-09-12.json',
    pointer: 'data/latest.json',
    stem: 'tariffs',
    fixture: 'test/fixtures/consumer-council/economy7-text-items.json'
  },
  standard: {
    published: 'data/tariffs-standard-2026-09-12.json',
    pointer: 'data/latest-standard.json',
    stem: 'tariffs-standard',
    fixture: 'test/fixtures/consumer-council/standard-text-items.json'
  }
};

const TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const args = { out: null, live: false, pdfs: new Map() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--live') args.live = true;
    else if (argv[i] === '--pdf') {
      const [family, path] = (argv[++i] ?? '').split('=');
      if (!family || !path) throw new Error('--pdf expects <family>=<path>');
      args.pdfs.set(family, path);
    } else throw new Error(`Unknown argument "${argv[i]}"`);
  }
  if (!args.out) throw new Error('--out <dir> is required');
  return args;
}

/**
 * Obtains the positioned text layer for one family. Discovery and download
 * problems are reported as the source being unavailable; a document that
 * cannot be read as the expected PDF is an extraction failure. The two are
 * kept apart because they call for different human attention.
 */
async function readSource(familyId, args) {
  const pdfPath = args.pdfs.get(familyId);
  if (pdfPath) return { extraction: extractTextItems(readFileSync(pdfPath)), origin: pdfPath };

  if (!args.live) {
    const fixture = JSON.parse(readFileSync(FAMILIES[familyId].fixture, 'utf8'));
    return { extraction: fixture, origin: FAMILIES[familyId].fixture, provenance: fixture.provenance ?? null };
  }

  const family = TARIFF_FAMILIES.find((f) => f.id === familyId);
  let pdfUrl;
  let buffer;
  try {
    const html = await fetchText(family.landingPageUrl, TIMEOUT_MS);
    pdfUrl = selectCurrentPdf(html, family.landingPageUrl, family).url;
    buffer = await fetchBinary(pdfUrl, TIMEOUT_MS);
    assertIsPdf(buffer, pdfUrl);
  } catch (error) {
    error.outcome = OUTCOMES.SOURCE_UNAVAILABLE;
    throw error;
  }
  return { extraction: extractTextItems(buffer), origin: pdfUrl };
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

const families = [];
const write = (name, body) => writeFileSync(join(args.out, name), body, 'utf8');
const writeJson = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');

for (const familyId of Object.keys(FAMILIES)) {
  const config = FAMILIES[familyId];
  let read;
  let table;
  let candidate;

  try {
    read = await readSource(familyId, args);
    table = assembleTable(read.extraction, familyId);
  } catch (error) {
    const outcome =
      error.outcome === OUTCOMES.SOURCE_UNAVAILABLE || error instanceof SourceFetchError || error instanceof SourceDiscoveryError
        ? OUTCOMES.SOURCE_UNAVAILABLE
        : OUTCOMES.EXTRACTION_FAILED;
    if (!(error instanceof PdfExtractionError || error instanceof TableAssemblyError || error instanceof SourceFetchError || error instanceof SourceDiscoveryError)) throw error;
    families.push(failedFamily(familyId, outcome, error));
    continue;
  }

  const published = JSON.parse(readFileSync(config.published, 'utf8'));

  try {
    candidate = mapToCanonical({ table, previous: { dataset: published, label: config.published } });
  } catch (error) {
    if (!(error instanceof MappingError)) throw error;
    families.push(failedFamily(familyId, OUTCOMES.EXTRACTION_FAILED, error));
    continue;
  }

  // The validator the application itself uses. A candidate that does not pass
  // it is an extraction failure, not a data change, and the validator is never
  // relaxed to let an extraction through.
  const { invalid } = validateDataset(candidate.dataset);
  if ((invalid ?? []).length > 0) {
    families.push(
      failedFamily(familyId, OUTCOMES.EXTRACTION_FAILED, {
        code: 'CANDIDATE_REJECTED_BY_VALIDATOR',
        message: `${invalid.length} record(s) do not satisfy src/validate.js: ${invalid.map((r) => r.id ?? '(no id)').join(', ')}`
      })
    );
    writeJson(`rejected-${familyId}.json`, invalid);
    continue;
  }

  const report = reconcile({ candidate, published, publishedLabel: config.published });
  const verdict = classifyFamily(report);
  families.push({ ...verdict, source_origin: read.origin, comparison_date: candidate.dataset.dataset.effective_from });

  const date = candidate.dataset.dataset.effective_from;

  // Always written: what the run saw and why it concluded what it did. These
  // are review material and carry no dataset.
  write(`reconciliation-${familyId}-${date}.md`, renderReconciliation(report));
  writeJson(`provenance-${familyId}-${date}.json`, {
    source_origin: read.origin,
    source_provenance: read.provenance ?? null,
    outcome: verdict.outcome,
    field_provenance: candidate.field_provenance,
    carry_forward_audit: candidate.carry_forward_audit,
    repeated_slots: candidate.repeated_slots,
    review_required: candidate.review_required,
    slot_accounting: report.slot_accounting
  });
  write(`source-rows-${familyId}-${date}.json`, JSON.stringify(candidate.source_row_trace) + '\n');

  // Written only for a clean change: the dated dataset and the pointer that
  // publishes it. A blocked family produces no dataset at all, so there is
  // nothing a reviewer could merge into production data while a question about
  // the source is open.
  if (verdict.outcome === OUTCOMES.CHANGED) {
    mkdirSync(join(args.out, 'data'), { recursive: true });
    writeJson(`data/${config.stem}-${date}.json`, candidate.dataset);
    const pointer = JSON.parse(readFileSync(config.pointer, 'utf8'));
    writeJson(`data/${config.pointer.split('/').pop()}`, { ...pointer, dataset: `${config.stem}-${date}.json` });
  }
}

const run = classifyRun(families);

// A family's dataset is written as it is classified, before the run as a whole
// is. A run that failed to read or reach one of the two documents has an
// incomplete picture of the source, so whatever the other family proposed is
// withdrawn here: the presence of a file under <out>/data is the automation's
// only permission to change published tariffs, so it must mean exactly what
// the run concluded.
if (run.data_update_families.length === 0) rmSync(join(args.out, 'data'), { recursive: true, force: true });

writeJson('outcome.json', run);
write(
  'summary.md',
  [
    `# Consumer Council extraction — ${run.outcome}`,
    '',
    run.headline,
    '',
    run.policy.summary,
    '',
    '| Table | Outcome | Why |',
    '|---|---|---|',
    ...families.map((f) => `| ${f.family} | \`${f.outcome}\` | ${f.reason} |`),
    ''
  ].join('\n')
);

console.log(run.headline);
for (const family of families) console.log(`  ${family.family}: ${family.outcome} — ${family.reason}`);
console.log(`\n${run.policy.summary}`);

// A hard failure fails the workflow. A blocked or changed run does not: it has
// something a person should look at, and an exit code would bury it.
if (run.workflow_fails) process.exitCode = 1;
