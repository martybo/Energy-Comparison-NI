import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDataset } from '../src/validate.js';

/**
 * Static-deployment safety net.
 *
 * The application has no build step: what is in the repository is what gets
 * served. These tests catch the specific way that can fail silently — the
 * pointer file and the dataset it names drifting apart, or a runtime file
 * index.html depends on going missing — none of which a calculation test
 * would ever exercise.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(root + rel, 'utf8');

test('every runtime file index.html imports or fetches exists', () => {
  const html = read('index.html');

  const modulePaths = [...html.matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(modulePaths.length > 0, 'expected at least one module import in index.html');
  for (const p of modulePaths) {
    assert.ok(existsSync(root + p.replace(/^\.\//, '')), `index.html imports "${p}", which does not exist`);
  }

  const fetchPaths = [...html.matchAll(/fetch\('([^'$]+)'\)/g)].map((m) => m[1]);
  assert.ok(fetchPaths.includes('data/latest.json'), 'index.html must fetch data/latest.json by a relative path');
  for (const p of fetchPaths) {
    assert.ok(!p.startsWith('/'), `"${p}" is root-relative and will not resolve under a GitHub Pages subpath`);
    assert.ok(!/^https?:\/\//.test(p), `"${p}" is an absolute URL; deployment must use a relative path`);
  }
});

test('data/latest.json points at a dataset file that actually exists', () => {
  const pointer = JSON.parse(read('data/latest.json'));
  assert.equal(typeof pointer.dataset, 'string');
  assert.ok(existsSync(root + 'data/' + pointer.dataset), `data/latest.json names "${pointer.dataset}", which is not in data/`);
});

test('the dataset data/latest.json points at validates with no rejected records', () => {
  const pointer = JSON.parse(read('data/latest.json'));
  const raw = JSON.parse(read('data/' + pointer.dataset));
  const report = validateDataset(raw);
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors, null, 2));
  assert.equal(report.rejected.length, 0);
  assert.ok(report.valid.length > 0, 'the live dataset must contain at least one valid tariff');
});

test('the reconciliation and source-row trace named in DATA.md exist for the live dataset', () => {
  const pointer = JSON.parse(read('data/latest.json'));
  const datedSuffix = pointer.dataset.replace(/^tariffs-/, '').replace(/\.json$/, '');
  const reconciliation = `docs/RECONCILIATION-${datedSuffix}.md`;
  const rowTrace = `docs/source-rows-${datedSuffix}.json`;
  assert.ok(existsSync(root + reconciliation), `expected ${reconciliation} alongside the live dataset`);
  assert.ok(existsSync(root + rowTrace), `expected ${rowTrace} alongside the live dataset`);
});

test('the optional standard-tariff dataset, if present, is internally consistent', () => {
  // data/latest-standard.json is optional: the application works with only
  // the economy7 dataset present, and must go on doing so once a real
  // standard-tariff dataset eventually retires. But whenever the pointer
  // exists, everything it names must actually be there and valid — the same
  // guarantee the primary dataset gets.
  const pointerPath = root + 'data/latest-standard.json';
  if (!existsSync(pointerPath)) return;
  const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
  assert.equal(typeof pointer.dataset, 'string');
  assert.ok(existsSync(root + 'data/' + pointer.dataset), `data/latest-standard.json names "${pointer.dataset}", which is not in data/`);

  const raw = JSON.parse(read('data/' + pointer.dataset));
  const report = validateDataset(raw);
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors, null, 2));
  assert.equal(report.rejected.length, 0);
  assert.ok(report.valid.length > 0, 'the standard dataset must contain at least one valid tariff');
  assert.ok(report.valid.every((t) => t.meter_type === 'standard'), 'every tariff in this dataset must be meter_type "standard"');

  const datedSuffix = pointer.dataset.replace(/^tariffs-standard-/, '').replace(/\.json$/, '');
  assert.ok(existsSync(root + `docs/RECONCILIATION-standard-${datedSuffix}.md`), 'expected a matching reconciliation document');
  assert.ok(existsSync(root + `docs/source-rows-standard-${datedSuffix}.json`), 'expected a matching source-row trace');
});

test('no development or tooling files are required at runtime', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /node_modules/, 'index.html must not reference node_modules');
  assert.doesNotMatch(html, /package\.json/, 'index.html must not reference package.json');
});
