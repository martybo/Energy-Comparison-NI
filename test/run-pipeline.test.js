import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { publicationNames } from '../scripts/extract/publication.mjs';

/**
 * The driver is tested as a process because the bugs this file exists to
 * catch live in the seam, not the logic: whether what reaches disk matches
 * what the run concluded. The workflow's only permission to change published
 * tariffs is the presence of files under <out>/publish, so that is what is
 * asserted — including that nothing there would replace a published file.
 */

const out = () => mkdtempSync(join(tmpdir(), 'extract-'));

/**
 * The driver compares against whatever the pointers currently publish. These
 * tests must not depend on that: once a candidate built from these fixtures is
 * merged, the published dataset *is* the candidate, and a test reading the
 * live pointers would fail on the very pull request that publishes it. So the
 * driver runs in a workspace whose pointers name the 12/09/2026 baseline —
 * files that stay in data/ for good, since a published file is never
 * overwritten.
 */
const BASELINE = { 'latest.json': 'tariffs-2026-09-12.json', 'latest-standard.json': 'tariffs-standard-2026-09-12.json' };

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'extract-ws-'));
  for (const shared of ['scripts', 'src', 'test', 'package.json']) symlinkSync(resolve(shared), join(root, shared));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'docs'));
  for (const [pointer, dataset] of Object.entries(BASELINE)) {
    copyFileSync(join('data', dataset), join(root, 'data', dataset));
    const current = JSON.parse(readFileSync(join('data', pointer), 'utf8'));
    writeFileSync(join(root, 'data', pointer), JSON.stringify({ ...current, dataset }, null, 2) + '\n');
  }
  copyFileSync('docs/RECONCILIATION-standard-2026-09-12.md', join(root, 'docs/RECONCILIATION-standard-2026-09-12.md'));
  copyFileSync('docs/source-rows-standard-2026-09-12.json', join(root, 'docs/source-rows-standard-2026-09-12.json'));
  return root;
}

function run(dir, extra = [], cwd = workspace()) {
  const stdout = execFileSync(process.execPath, ['scripts/extract/run-pipeline.mjs', '--out', dir, ...extra], { encoding: 'utf8', cwd });
  return { stdout, cwd, outcome: JSON.parse(readFileSync(join(dir, 'outcome.json'), 'utf8')) };
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath ?? e.path, e.name)))
    .sort();
}

/** The shipped decisions file without the Gate 1 grouping decision. */
function identityOnlyFile() {
  const file = JSON.parse(readFileSync('scripts/extract/source-decisions.json', 'utf8'));
  file.decisions = file.decisions.filter((d) => d.kind === 'identity');
  const path = join(out(), 'decisions.json');
  writeFileSync(path, JSON.stringify(file));
  return path;
}

// --- the decided state: a clean Standard change ----------------------------

test('with the recorded decisions, the fixtures give a Standard change and no Economy 7 change', () => {
  const { outcome } = run(out());
  assert.equal(outcome.outcome, 'changed');
  assert.deepEqual(outcome.families.map((f) => [f.family, f.outcome]), [['economy7', 'unchanged'], ['standard', 'changed']]);
  assert.deepEqual(outcome.data_update_families, ['standard']);
});

test('a correction to an already-published snapshot is published beside it, never over it', () => {
  // The fixture is the same 12/09/2026 snapshot the published Standard
  // dataset came from, so its dated name is taken.
  const dir = out();
  const { cwd } = run(dir);
  assert.deepEqual(filesUnder(join(dir, 'publish')), [
    'data/latest-standard.json',
    'data/tariffs-standard-2026-09-12-r2.json',
    'docs/PROVENANCE-standard-2026-09-12-r2.json',
    'docs/RECONCILIATION-standard-2026-09-12-r2.md',
    'docs/source-rows-standard-2026-09-12-r2.json'
  ]);
  for (const path of filesUnder(join(dir, 'publish'))) {
    if (path === 'data/latest.json' || path === 'data/latest-standard.json') continue;
    assert.ok(!existsSync(join(cwd, path)), `${path} already exists and must not be proposed over it`);
  }
  const pointer = JSON.parse(readFileSync(join(dir, 'publish/data/latest-standard.json'), 'utf8'));
  assert.equal(pointer.dataset, 'tariffs-standard-2026-09-12-r2.json');
});

test('the proposed pointer keeps everything else the published pointer says', () => {
  const dir = out();
  const { cwd } = run(dir);
  const proposed = JSON.parse(readFileSync(join(dir, 'publish/data/latest-standard.json'), 'utf8'));
  const current = JSON.parse(readFileSync(join(cwd, 'data/latest-standard.json'), 'utf8'));
  assert.deepEqual({ ...proposed, dataset: current.dataset }, current);
});

test('the published provenance carries the decisions and the source discrepancy permanently', () => {
  // Once merged, this file — not a review directory a later run overwrites —
  // is where the reasons behind the published data live.
  const dir = out();
  run(dir);
  const provenance = JSON.parse(readFileSync(join(dir, 'publish/docs/PROVENANCE-standard-2026-09-12-r2.json'), 'utf8'));
  assert.equal(provenance.published_as, 'data/tariffs-standard-2026-09-12-r2.json');
  assert.deepEqual(
    provenance.decisions_applied.map((d) => d.decision_id).sort(),
    ['standard-sse-1-year-home-keypad-10-5-identity', 'standard-sse-24hr-standard-rate-row-grouping']
  );
  const grouping = provenance.decisions_applied.find((d) => d.kind === 'grouping');
  assert.match(grouping.source_discrepancies[0].discrepancy, /2\.5%/);
  assert.equal(provenance.shared_slots.length, 1);
  assert.ok(provenance.field_provenance['sse-airtricity-standard-rate-24hr']);
  assert.ok(provenance.carry_forward_audit.length > 0);
});

test('no review-only material is published with a data change', () => {
  const dir = out();
  run(dir);
  assert.ok(!filesUnder(join(dir, 'publish')).some((f) => f.startsWith('docs/candidates/')));
});

test('publication names follow the convention the deployment tests enforce', () => {
  const standard = { stem: 'tariffs-standard', docsPrefix: 'standard-' };
  const economy7 = { stem: 'tariffs', docsPrefix: '' };
  assert.deepEqual(publicationNames(economy7, '2026-10-30', () => false), {
    suffix: '2026-10-30',
    dataset: 'data/tariffs-2026-10-30.json',
    reconciliation: 'docs/RECONCILIATION-2026-10-30.md',
    sourceRows: 'docs/source-rows-2026-10-30.json',
    provenance: 'docs/PROVENANCE-2026-10-30.json'
  });
  const taken = new Set(['data/tariffs-standard-2026-09-12.json', 'docs/RECONCILIATION-standard-2026-09-12-r2.md']);
  assert.equal(publicationNames(standard, '2026-09-12', (p) => taken.has(p)).suffix, '2026-09-12-r3');
  // A provenance record already published under a name also takes it.
  const provenanceTaken = new Set(['docs/PROVENANCE-standard-2026-09-12.json']);
  assert.equal(publicationNames(standard, '2026-09-12', (p) => provenanceTaken.has(p)).suffix, '2026-09-12-r2');
});

// --- the undecided state: blocked, nothing proposed ------------------------

test('without the Gate 1 decision the run is blocked and proposes no tariff data', () => {
  const dir = out();
  const { outcome } = run(dir, ['--decisions', identityOnlyFile()]);
  assert.equal(outcome.outcome, 'blocked');
  assert.deepEqual(outcome.data_update_families, []);
  assert.equal(existsSync(join(dir, 'publish')), false, 'a blocked run must leave nothing a reviewer could merge');
});

test('a blocked run still writes the review material a person needs', () => {
  const dir = out();
  run(dir, ['--decisions', identityOnlyFile()]);
  const files = readdirSync(dir);
  for (const name of ['outcome.json', 'summary.md']) assert.ok(files.includes(name), name);
  assert.ok(files.some((f) => f.startsWith('reconciliation-standard-')));
  assert.ok(files.some((f) => f.startsWith('provenance-standard-')));
  assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /ambiguous_product_grouping/);
});

test('a blocked run reports the outcome on stdout without calling it an update', () => {
  const { stdout } = run(out(), ['--decisions', identityOnlyFile()]);
  assert.match(stdout, /no tariff data is proposed/);
  assert.doesNotMatch(stdout, /\bupdated\b/i);
});

// --- invariants ------------------------------------------------------------

test('the driver refuses to run without an output directory', () => {
  assert.throws(() => execFileSync(process.execPath, ['scripts/extract/run-pipeline.mjs'], { stdio: 'pipe' }));
});

test('the driver never writes to the published data or docs directories', () => {
  const cwd = workspace();
  const snapshot = (d) => filesUnder(join(cwd, d)).map((f) => [f, readFileSync(join(cwd, d, f), 'utf8')]);
  const before = [snapshot('data'), snapshot('docs')];
  run(out(), [], cwd);
  run(out(), ['--decisions', identityOnlyFile()], cwd);
  assert.deepEqual([snapshot('data'), snapshot('docs')], before);
});

test('the published dataset is read through its pointer, not a fixed name', () => {
  // Point Standard at a dataset identical to what this fixture produces: the
  // run must then find nothing to change.
  const first = out();
  const cwd = workspace();
  run(first, [], cwd);
  copyFileSync(join(first, 'publish/data/tariffs-standard-2026-09-12-r2.json'), join(cwd, 'data/tariffs-standard-2026-09-12-r2.json'));
  copyFileSync(join(first, 'publish/data/latest-standard.json'), join(cwd, 'data/latest-standard.json'));
  const { outcome } = run(out(), [], cwd);
  assert.equal(outcome.families.find((f) => f.family === 'standard').outcome, 'unchanged');
});
