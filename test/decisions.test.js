import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assembleTable } from '../scripts/extract/table.mjs';
import { mapToCanonical, MappingError, FIELD_PROVENANCE } from '../scripts/extract/map-canonical.mjs';
import { decisionsForFamily } from '../scripts/extract/decisions.mjs';
import { reconcile } from '../scripts/extract/reconcile.mjs';
import { classifyFamily, OUTCOMES, validatorFailure } from '../scripts/extract/outcomes.mjs';
import { validateDataset } from '../src/validate.js';

/**
 * Recorded decisions are the one place a person's judgement enters the
 * pipeline, so these tests are about the edges: a decision applies to exactly
 * the row it was made about and nothing else, stops applying when the source
 * changes, and can never be malformed into silence.
 */

const fixture = () => JSON.parse(readFileSync('test/fixtures/consumer-council/standard-text-items.json', 'utf8'));
const published = () => JSON.parse(readFileSync('data/tariffs-standard-2026-09-12.json', 'utf8'));
const shipped = () => JSON.parse(readFileSync('scripts/extract/source-decisions.json', 'utf8'));

const PRODUCT = 'sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr';
const PRINTED = '1 Year Home Keypad 10.5% discount plus £30 welcome credit (24hr)';

function run({ decisions = shipped(), mutate = () => {}, previous = published() } = {}) {
  const table = assembleTable(fixture(), 'standard');
  mutate(table);
  return mapToCanonical({ table, previous: { dataset: previous, label: 'data/tariffs-standard-2026-09-12.json' }, decisions });
}

// --- the shipped decision --------------------------------------------------

test('the shipped decisions file is valid', () => {
  assert.doesNotThrow(() => decisionsForFamily(shipped(), 'standard'));
  assert.doesNotThrow(() => decisionsForFamily(shipped(), 'economy7'));
});

test('without the decision, the renamed SSE keypad tariff is a new product and gated', () => {
  const result = run({ decisions: null });
  assert.ok(result.review_required.some((r) => r.reason === 'tier2_missing_for_new_product' && r.field === 'reverts_to'));
  assert.ok(!result.dataset.tariffs.some((t) => t.id === PRODUCT));
});

test('with the decision, the printed row is the published product under its printed name', () => {
  const result = run();
  const tariff = result.dataset.tariffs.find((t) => t.id === PRODUCT);
  assert.ok(tariff, 'the published id is kept');
  assert.equal(tariff.name, PRINTED, 'the name is what the source prints');
  assert.ok(!result.review_required.some((r) => r.product_id === PRODUCT));
  assert.equal(result.field_provenance[PRODUCT].product_identity, FIELD_PROVENANCE.HUMAN_DECISION);
  assert.equal(result.field_provenance[PRODUCT].name, FIELD_PROVENANCE.SOURCE_DERIVED);
});

test('the corrected product differs from the published one only in its name', () => {
  const before = published().tariffs.find((t) => t.id === PRODUCT);
  const after = run().dataset.tariffs.find((t) => t.id === PRODUCT);
  for (const field of ['supplier', 'status', 'rate_basis', 'headline_discount_pct', 'intro_period_months', 'intro_period_basis', 'reverts_to', 'contract', 'eligibility', 'rates', 'adjustments']) {
    assert.deepEqual(after[field], before[field], `${field} must be unchanged by an identity correction`);
  }
  assert.notEqual(after.name, before.name);
});

test('carrying reverts_to across a decided identity says so in the audit', () => {
  const entry = run().carry_forward_audit.find((a) => a.product_id === PRODUCT && a.field === 'reverts_to');
  assert.equal(entry.identity_basis, 'decision:standard-sse-1-year-home-keypad-10-5-identity');
  assert.match(entry.eligible_because, /recorded decision/);
  assert.equal(entry.source_contradicts, false);
});

test('an applied decision is recorded with who made it and the names on both sides', () => {
  const [applied] = run().decisions_applied;
  assert.equal(applied.product_id, PRODUCT);
  assert.equal(applied.printed_name, PRINTED);
  assert.equal(applied.previous_name, '1 Year Keypad 10.5% discount plus £30 welcome credit (24hr)');
  assert.match(applied.decided_by, /martybo/);
});

// --- anchoring -------------------------------------------------------------

test('a decision stops applying when the Council changes the printed name', () => {
  const result = run({
    mutate: (table) => {
      const row = table.rows.find((r) => r.tariff_name === PRINTED);
      row.tariff_name = '1 Year Home Keypad 11% discount plus £30 welcome credit (24hr)';
    }
  });
  assert.equal(result.decisions_applied.length, 0);
  assert.deepEqual(result.decisions_unmatched.map((d) => d.decision_id), ['standard-sse-1-year-home-keypad-10-5-identity']);
  // The row is not understood again, so it blocks rather than inheriting.
  assert.ok(result.review_required.some((r) => r.reason === 'tier2_missing_for_new_product'));
});

test('a decision stops applying when the printed payment methods change', () => {
  const result = run({
    mutate: (table) => {
      const row = table.rows.find((r) => r.tariff_name === PRINTED);
      row.payment_methods = [{ method: 'on_receipt_postal', phrase: 'Pay on receipt of bill' }];
    }
  });
  assert.equal(result.decisions_applied.length, 0);
});

test('a price change alone does not stop an identity decision applying', () => {
  // The decision is about what the name refers to. A new month's price is a
  // normal change and must not demand the identity be decided again.
  const result = run({
    mutate: (table) => {
      table.rows.find((r) => r.tariff_name === PRINTED).rates.unit_p_per_kwh = 37.25;
    }
  });
  assert.equal(result.decisions_applied.length, 1);
});

test('a decision anchored on printed rates stops applying when they change', () => {
  const decisions = shipped();
  decisions.decisions[0].match.printed_rates = { unit_p_per_kwh: 36.51 };
  assert.equal(run({ decisions }).decisions_applied.length, 1);
  const moved = run({
    decisions,
    mutate: (table) => {
      table.rows.find((r) => r.tariff_name === PRINTED).rates.unit_p_per_kwh = 37.25;
    }
  });
  assert.equal(moved.decisions_applied.length, 0);
});

test('a decision is retired, not reapplied, once the published name is corrected', () => {
  const corrected = published();
  corrected.tariffs.find((t) => t.id === PRODUCT).name = PRINTED;
  const result = run({ previous: corrected });
  assert.equal(result.decisions_applied.length, 0);
  assert.deepEqual(result.decisions_redundant.map((d) => d.decision_id), ['standard-sse-1-year-home-keypad-10-5-identity']);
  assert.ok(result.dataset.tariffs.some((t) => t.id === PRODUCT && t.name === PRINTED));
});

test('a decision naming a product the previous dataset lacks is a gate, not a fallback', () => {
  const decisions = shipped();
  decisions.decisions[0].decision.product_id = 'sse-airtricity-no-such-product';
  const result = run({ decisions });
  const gate = result.review_required.find((r) => r.reason === 'decision_not_applicable');
  assert.ok(gate);
  assert.equal(gate.detail.problem, 'target_missing');
  assert.equal(gate.unresolved_slots, 1);
  assert.ok(!result.dataset.tariffs.some((t) => t.name === PRINTED), 'the row must not be mapped some other way instead');
});

// --- malformed decisions fail loudly ---------------------------------------

for (const [label, mutate, pattern] of [
  ['an unknown kind', (d) => (d.kind = 'grouping_guess'), /unknown kind/],
  ['a missing reason', (d) => delete d.reason, /reason/],
  ['a missing decided_by', (d) => delete d.decided_by, /decided_by/],
  ['missing evidence', (d) => delete d.evidence, /evidence/],
  ['a canonical name that is not the printed one', (d) => (d.decision.canonical_name = '1 Year Keypad (tidied)'), /exactly the printed tariff name/],
  ['no printed payment methods', (d) => (d.match.printed_payment_methods = []), /printed_payment_methods/]
]) {
  test(`a decision with ${label} is refused, not skipped`, () => {
    const decisions = shipped();
    mutate(decisions.decisions[0]);
    assert.throws(() => run({ decisions }), (err) => err instanceof MappingError && err.code === 'MALFORMED_DECISION' && pattern.test(err.message));
  });
}

test('two decisions with the same id are refused', () => {
  const decisions = shipped();
  decisions.decisions.push(structuredClone(decisions.decisions[0]));
  assert.throws(() => run({ decisions }), (err) => err.code === 'MALFORMED_DECISION' && /duplicates/.test(err.message));
});

test('two decisions matching the same printed row are refused', () => {
  const decisions = shipped();
  const second = structuredClone(decisions.decisions[0]);
  second.id = 'a-second-opinion';
  decisions.decisions.push(second);
  assert.throws(() => run({ decisions }), (err) => err.code === 'CONFLICTING_DECISIONS');
});

test('a decisions file without a decisions array is refused', () => {
  assert.throws(() => run({ decisions: { decision: [] } }), (err) => err.code === 'MALFORMED_DECISIONS');
});

// --- what remains blocked, and why -----------------------------------------

test('with Gate 2 decided, Standard is still blocked by Gate 1 alone', () => {
  const candidate = run();
  const report = reconcile({ candidate, published: published() });
  assert.equal(classifyFamily(report).outcome, OUTCOMES.BLOCKED);
  const reasons = new Set(report.gates.map((g) => g.reason));
  assert.deepEqual([...reasons].sort(), ['ambiguous_product_grouping', 'validator_warning_introduced']);
  assert.ok(report.slot_accounting.balanced);
});

test('a candidate that leaves tariffs reverting to a missing product is gated', () => {
  // Gate 1 leaves "Standard Rate 24hr" unmapped, and eight SSE fixed-term
  // tariffs revert to it. The app's validator only warns — their ongoing cost
  // becomes unknown — which is right for the app and must not pass review
  // silently.
  const report = reconcile({ candidate: run(), published: published() });
  const introduced = report.gates.filter((g) => g.kind === 'validator_warning_introduced');
  assert.equal(introduced.length, 8);
  assert.ok(introduced.every((g) => g.validator_code === 'reverts_to_unresolved'));
});

// --- the validator verdict -------------------------------------------------

test('validatorFailure reads the keys the validator actually returns', () => {
  const clean = validateDataset(published());
  assert.ok('rejected' in clean && 'errors' in clean, 'src/validate.js result shape changed');
  assert.equal(validatorFailure(clean), null);
});

test('a rejected record or a dataset error fails the candidate', () => {
  const broken = published();
  broken.tariffs[0].rates[0].unit_p_per_kwh = 'not a number';
  const rejected = validatorFailure(validateDataset(broken));
  assert.equal(rejected?.code, 'CANDIDATE_REJECTED_BY_VALIDATOR');
  assert.ok(rejected.rejected.length > 0);

  const undated = published();
  undated.dataset.effective_from = 'yesterday';
  assert.equal(validatorFailure(validateDataset(undated))?.code, 'CANDIDATE_REJECTED_BY_VALIDATOR');
});

test('an unreadable validator verdict is a failure, not a pass', () => {
  assert.equal(validatorFailure({ valid: [] })?.code, 'VALIDATOR_RESULT_UNREADABLE');
  assert.equal(validatorFailure(undefined)?.code, 'VALIDATOR_RESULT_UNREADABLE');
});

// --- reporting what Gate 1 leaves unmapped honestly ------------------------

test('products printed inside the unresolved row are awaiting a decision, not gone', () => {
  const report = reconcile({ candidate: run(), published: published() });
  const awaiting = report.products.awaiting_decision.map((t) => t.id);
  assert.ok(awaiting.includes('sse-airtricity-standard-rate-24hr'));
  assert.ok(!report.products.removed.some((t) => t.id === 'sse-airtricity-standard-rate-24hr'), 'must not read as a withdrawal');
});

test('a product genuinely no longer printed is still reported as gone', () => {
  const report = reconcile({
    candidate: run({
      mutate: (table) => {
        table.rows = table.rows.filter((r) => r.tariff_name !== 'Keypad Loyalty 20% Discount');
        table.totals.payment_method_slots -= 1;
      }
    }),
    published: published()
  });
  assert.ok(report.products.removed.some((t) => t.id === 'budget-energy-keypad-loyalty-20-discount'));
  assert.ok(!report.products.awaiting_decision.some((t) => t.id === 'budget-energy-keypad-loyalty-20-discount'));
});

test('a new product\'s validator warnings are reported but do not block', () => {
  // A brand-new discounted tariff with no stated intro period has an unknown
  // ongoing cost. That is normal and must not hold up an ordinary month; only
  // a continuing product that has lost information is gated.
  const report = reconcile({
    candidate: run({
      mutate: (table) => {
        const row = table.rows.find((r) => r.tariff_name === 'Billpay 25% Discount');
        row.tariff_name = 'Billpay 25% Discount Plus';
      }
    }),
    published: published()
  });
  const newId = 'budget-energy-billpay-25-discount-plus';
  assert.ok(report.products.added.some((t) => t.id === newId));
  const warning = report.introduced_validator_warnings.find((w) => w.tariffId === newId);
  assert.ok(warning, 'the new product\'s warning is reported');
  assert.equal(warning.gated, false);
  assert.ok(!report.gates.some((g) => g.kind === 'validator_warning_introduced' && g.product_id === newId));
});
