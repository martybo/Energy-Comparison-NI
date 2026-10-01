import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assembleTable } from '../scripts/extract/table.mjs';
import { mapToCanonical } from '../scripts/extract/map-canonical.mjs';
import { reconcile } from '../scripts/extract/reconcile.mjs';
import { OUTCOMES, OUTCOME_POLICY, classifyFamily, classifyRun, failedFamily } from '../scripts/extract/outcomes.mjs';

/**
 * The property these tests exist to protect: a run that only partly
 * understood the source must never be able to produce something that looks
 * like a normal tariff update. Every outcome but a clean change forbids a data
 * update, and that is asserted directly rather than inferred from the
 * workflow's shape.
 */

const fixture = (family) => JSON.parse(readFileSync(`test/fixtures/consumer-council/${family}-text-items.json`, 'utf8'));
const dataset = (file) => JSON.parse(readFileSync(`data/${file}`, 'utf8'));

function reportFor(family, file, mutate = () => {}) {
  const published = dataset(file);
  const table = assembleTable(fixture(family), family);
  mutate(table);
  const candidate = mapToCanonical({ table, previous: { dataset: published, label: `data/${file}` } });
  return reconcile({ candidate, published, publishedLabel: `data/${file}` });
}

test('only a clean change permits a data update', () => {
  for (const [outcome, policy] of Object.entries(OUTCOME_POLICY)) {
    if (outcome === OUTCOMES.CHANGED) assert.equal(policy.data_update, true);
    else assert.equal(policy.data_update, false, `${outcome} must not permit a data update`);
  }
});

test('a failure to read or reach the source fails the workflow; a question about it does not', () => {
  assert.equal(OUTCOME_POLICY[OUTCOMES.SOURCE_UNAVAILABLE].workflow_fails, true);
  assert.equal(OUTCOME_POLICY[OUTCOMES.EXTRACTION_FAILED].workflow_fails, true);
  // A blocked run has something a person should look at; a red workflow with
  // no artifact would bury it.
  assert.equal(OUTCOME_POLICY[OUTCOMES.BLOCKED].workflow_fails, false);
  assert.equal(OUTCOME_POLICY[OUTCOMES.BLOCKED].candidate_pr, true);
  assert.equal(OUTCOME_POLICY[OUTCOMES.UNCHANGED].candidate_pr, false);
});

test('the Standard table as the source currently prints it is blocked, not a data change', () => {
  const verdict = classifyFamily(reportFor('standard', 'tariffs-standard-2026-09-12.json'));
  assert.equal(verdict.outcome, OUTCOMES.BLOCKED);
  // It has real changes too — the 46th payment slot among them — and is still
  // blocked: a change does not outrank an unresolved question.
  assert.ok(verdict.material_changes > 0);
  assert.equal(OUTCOME_POLICY[verdict.outcome].data_update, false);
});

test('a republished source with no material difference is unchanged, not a change', () => {
  // The Economy 7 capture is dated a day after the published dataset and every
  // record's transcribed wording differs, but no rate, term, credit,
  // eligibility or payment method moved. Rewriting the dataset to record a new
  // date would be churn.
  const report = reportFor('economy7', 'tariffs-2026-09-12.json');
  const verdict = classifyFamily(report);
  assert.equal(verdict.outcome, OUTCOMES.UNCHANGED);
  assert.ok(report.dataset_fields.some((f) => f.field === 'effective_from'));
  assert.ok(report.products.wording_only.length > 0);
  assert.match(verdict.reason, /no rate, term, credit, eligibility or payment method moved/);
});

test('a moved rate is a clean change and does permit a data update', () => {
  const report = reportFor('economy7', 'tariffs-2026-09-12.json', (table) => {
    table.rows[0].rates.day_p_per_kwh = 41.111;
  });
  const verdict = classifyFamily(report);
  assert.equal(verdict.outcome, OUTCOMES.CHANGED);
  assert.equal(OUTCOME_POLICY[verdict.outcome].data_update, true);
  assert.equal(report.publishable, true);
});

test('a run is as weak as its weakest table', () => {
  const run = classifyRun([
    { family: 'economy7', outcome: OUTCOMES.CHANGED, material_changes: 3, gates: 0, reason: '' },
    { family: 'standard', outcome: OUTCOMES.BLOCKED, material_changes: 1, gates: 2, reason: '' }
  ]);
  assert.equal(run.outcome, OUTCOMES.BLOCKED);
  // The two tables are separate documents, so the clean one still proposes its
  // data update while the blocked one proposes none.
  assert.deepEqual(run.data_update_families, ['economy7']);
  assert.deepEqual(run.review_only_families, ['standard']);
  assert.equal(run.workflow_fails, false);
});

test('a run that could not read a document proposes no data update at all', () => {
  for (const outcome of [OUTCOMES.SOURCE_UNAVAILABLE, OUTCOMES.EXTRACTION_FAILED]) {
    const run = classifyRun([
      { family: 'economy7', outcome: OUTCOMES.CHANGED, material_changes: 5, gates: 0, reason: '' },
      failedFamily('standard', outcome, { code: 'X', message: 'y' })
    ]);
    assert.equal(run.outcome, outcome);
    assert.deepEqual(run.data_update_families, [], 'an incomplete picture of the source publishes nothing');
    assert.equal(run.workflow_fails, true);
  }
});

test('no headline describes a partly understood run as an update', () => {
  for (const outcome of [OUTCOMES.SOURCE_UNAVAILABLE, OUTCOMES.EXTRACTION_FAILED, OUTCOMES.BLOCKED]) {
    const run = classifyRun([failedFamily('standard', outcome, { code: 'X', message: 'y' })]);
    assert.doesNotMatch(run.headline, /\bupdated\b/i);
    assert.match(run.headline, /no tariff data is proposed|unresolved/i);
  }
});

test('a failed family records the error code that caused it', () => {
  const family = failedFamily('standard', OUTCOMES.EXTRACTION_FAILED, {
    code: 'UNEXPECTED_TABLE_HEADERS',
    message: 'Page 2 does not print the expected columns'
  });
  assert.match(family.reason, /UNEXPECTED_TABLE_HEADERS/);
  assert.equal(family.material_changes, 0);
});
