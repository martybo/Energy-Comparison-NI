import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * The driver is tested as a process because the bug this file exists to catch
 * lives in the seam, not the logic: whether what reaches disk matches what the
 * run concluded. The workflow's only permission to change published tariffs is
 * the presence of a file under <out>/data, so that is what is asserted.
 */

const out = () => mkdtempSync(join(tmpdir(), 'extract-'));

function run(dir) {
  const stdout = execFileSync(process.execPath, ['scripts/extract/run-pipeline.mjs', '--out', dir], { encoding: 'utf8' });
  return { stdout, outcome: JSON.parse(readFileSync(join(dir, 'outcome.json'), 'utf8')) };
}

test('the fixtures as captured give a blocked run that proposes no tariff data', () => {
  const dir = out();
  const { outcome } = run(dir);
  assert.equal(outcome.outcome, 'blocked');
  assert.deepEqual(outcome.data_update_families, []);
  assert.equal(existsSync(join(dir, 'data')), false, 'a blocked run must leave nothing a reviewer could merge into data/');
});

test('a blocked run still writes the review material a person needs', () => {
  const dir = out();
  run(dir);
  const files = readdirSync(dir);
  assert.ok(files.includes('outcome.json'));
  assert.ok(files.includes('summary.md'));
  assert.ok(files.some((f) => f.startsWith('reconciliation-standard-')));
  assert.ok(files.some((f) => f.startsWith('provenance-standard-')));
  const summary = readFileSync(join(dir, 'summary.md'), 'utf8');
  assert.match(summary, /blocked/);
  assert.match(summary, /ambiguous_product_grouping|unresolved/);
});

test('the run reports the outcome on stdout without calling it an update', () => {
  const { stdout } = run(out());
  assert.match(stdout, /no tariff data is proposed/);
  assert.doesNotMatch(stdout, /\bupdated\b/i);
});

test('the driver refuses to run without an output directory', () => {
  assert.throws(() => execFileSync(process.execPath, ['scripts/extract/run-pipeline.mjs'], { stdio: 'pipe' }));
});

test('the driver never writes to the published data directory', () => {
  const before = readdirSync('data').map((f) => [f, readFileSync(join('data', f), 'utf8')]);
  run(out());
  const after = readdirSync('data').map((f) => [f, readFileSync(join('data', f), 'utf8')]);
  assert.deepEqual(after, before, 'data/ must be read-only to the extraction');
});
