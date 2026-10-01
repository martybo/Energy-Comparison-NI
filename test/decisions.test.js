import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assembleTable } from '../scripts/extract/table.mjs';
import { mapToCanonical, MappingError, FIELD_PROVENANCE } from '../scripts/extract/map-canonical.mjs';
import { decisionsForFamily } from '../scripts/extract/decisions.mjs';
import { reconcile, renderReconciliation } from '../scripts/extract/reconcile.mjs';
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

const IDENTITY = 'standard-sse-1-year-home-keypad-10-5-identity';
const GROUPING = 'standard-sse-24hr-standard-rate-row-grouping';
/** The shipped file with only the identity decision — the state before Gate 1 was decided. */
const identityOnly = () => {
  const file = shipped();
  file.decisions = file.decisions.filter((d) => d.id === IDENTITY);
  return file;
};
const appliedIds = (result) => result.decisions_applied.map((d) => d.decision_id);
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
  const applied = run().decisions_applied.find((d) => d.decision_id === IDENTITY);
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
  assert.ok(!appliedIds(result).includes(IDENTITY));
  assert.deepEqual(result.decisions_unmatched.map((d) => d.decision_id), [IDENTITY]);
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
  assert.ok(!appliedIds(result).includes(IDENTITY));
});

test('a price change alone does not stop an identity decision applying', () => {
  // The decision is about what the name refers to. A new month's price is a
  // normal change and must not demand the identity be decided again.
  const result = run({
    mutate: (table) => {
      table.rows.find((r) => r.tariff_name === PRINTED).rates.unit_p_per_kwh = 37.25;
    }
  });
  assert.ok(appliedIds(result).includes(IDENTITY));
});

test('a decision anchored on printed rates stops applying when they change', () => {
  const decisions = shipped();
  decisions.decisions[0].match.printed_rates = { unit_p_per_kwh: 36.51 };
  assert.ok(appliedIds(run({ decisions })).includes(IDENTITY));
  const moved = run({
    decisions,
    mutate: (table) => {
      table.rows.find((r) => r.tariff_name === PRINTED).rates.unit_p_per_kwh = 37.25;
    }
  });
  assert.ok(!appliedIds(moved).includes(IDENTITY));
});

test('a decision is retired, not reapplied, once the published name is corrected', () => {
  const corrected = published();
  corrected.tariffs.find((t) => t.id === PRODUCT).name = PRINTED;
  const result = run({ previous: corrected });
  assert.ok(!appliedIds(result).includes(IDENTITY));
  assert.deepEqual(result.decisions_redundant.map((d) => d.decision_id), [IDENTITY]);
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

test('with only Gate 2 decided, Standard is blocked by Gate 1 alone', () => {
  const candidate = run({ decisions: identityOnly() });
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
  const report = reconcile({ candidate: run({ decisions: identityOnly() }), published: published() });
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
  const report = reconcile({ candidate: run({ decisions: identityOnly() }), published: published() });
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

// --- Gate 1: the recorded grouping decision ---------------------------------

const ROW_NAMES = ['SmartSaver Std 24hr', 'Keypad Standard Rate 24hr', 'Standard Rate 24hr'];
const groupedRow = (table) => table.rows.find((r) => ROW_NAMES.every((n) => r.tariff_name.includes(n)));

test('with both decisions recorded, Standard is a clean change with every slot accounted for', () => {
  const report = reconcile({ candidate: run(), published: published() });
  assert.deepEqual(report.gates, []);
  assert.equal(classifyFamily(report).outcome, OUTCOMES.CHANGED);
  const a = report.slot_accounting;
  assert.equal(a.balanced, true);
  // One printed "Pay on receipt of bill" slot, given by the decision to two
  // tariffs: shown, not read as a slot gained.
  assert.equal(a.rate_rows_from_shared_slots, 1);
  assert.equal(a.slots_in_unresolved_rows, 0);
});

test('the grouped row becomes exactly the three priced tariffs the decision records', () => {
  const tariffs = new Map(run().dataset.tariffs.map((t) => [t.id, t]));
  const methods = (id) => tariffs.get(id).rates.map((r) => r.payment_method).sort();
  assert.deepEqual(methods('sse-airtricity-smartsaver-std-24hr'), ['on_receipt_postal']);
  assert.deepEqual(methods('sse-airtricity-standard-rate-24hr'), ['on_receipt_postal']);
  assert.deepEqual(methods('sse-airtricity-keypad-standard-rate-24hr'), ['prepayment']);
  for (const id of ['sse-airtricity-smartsaver-std-24hr', 'sse-airtricity-standard-rate-24hr', 'sse-airtricity-keypad-standard-rate-24hr']) {
    assert.equal(tariffs.get(id).rates[0].unit_p_per_kwh, 40.79, `${id} is priced as the Council prints the row`);
  }
  assert.equal(tariffs.get('sse-airtricity-smartsaver-std-24hr').name, 'SmartSaver Std 24hr');
});

test('the decision makes no identity claim between SmartSaver Std 24hr and Standard Rate 24hr', () => {
  // They are two tariffs the row represents at one rate, not one product
  // under two names.
  const result = run();
  assert.ok(result.dataset.tariffs.some((t) => t.id === 'sse-airtricity-smartsaver-std-24hr'));
  assert.ok(result.dataset.tariffs.some((t) => t.id === 'sse-airtricity-standard-rate-24hr'));
  const applied = result.decisions_applied.find((d) => d.decision_id === GROUPING);
  assert.equal(applied.products.length, 3);
});

test('the unprinted on_receipt_ebill slot is not carried', () => {
  const report = reconcile({ candidate: run(), published: published() });
  const change = report.products.changed.find((c) => c.id === 'sse-airtricity-standard-rate-24hr');
  assert.deepEqual(change.rates.removed, ['on_receipt_ebill']);
});

test('the grouping is tagged a human decision and the SSE discrepancy is recorded', () => {
  const result = run();
  for (const id of ['sse-airtricity-smartsaver-std-24hr', 'sse-airtricity-standard-rate-24hr', 'sse-airtricity-keypad-standard-rate-24hr']) {
    assert.equal(result.field_provenance[id].product_grouping, FIELD_PROVENANCE.HUMAN_DECISION, id);
  }
  const applied = result.decisions_applied.find((d) => d.decision_id === GROUPING);
  assert.deepEqual(applied.source_discrepancies.map((x) => x.product_id), ['sse-airtricity-keypad-standard-rate-24hr']);
  assert.match(applied.source_discrepancies[0].discrepancy, /2\.5%/);
  // Recorded in provenance, not written into the source's own wording.
  const keypad = result.dataset.tariffs.find((t) => t.id === 'sse-airtricity-keypad-standard-rate-24hr');
  assert.doesNotMatch(keypad.notes ?? '', /2\.5%/);
});

test('every tariff that reverts to a grouped product now has a target, and no information is lost', () => {
  const candidate = run();
  const ids = new Set(candidate.dataset.tariffs.map((t) => t.id));
  assert.deepEqual(candidate.dataset.tariffs.filter((t) => t.reverts_to && !ids.has(t.reverts_to)).map((t) => t.id), []);
  const report = reconcile({ candidate, published: published() });
  assert.deepEqual(report.introduced_validator_warnings.filter((w) => w.gated), []);
});

test('the grouping decision matches the three names in any bullet order', () => {
  // The 30/09/2026 table prints the same names in a different order.
  const result = run({
    mutate: (table) => {
      groupedRow(table).tariff_name = 'SmartSaver Std 24hr Standard Rate 24hr Keypad Standard Rate 24hr';
    }
  });
  assert.ok(appliedIds(result).includes(GROUPING));
});

for (const [label, mutate] of [
  ['a printed name changes', (row) => (row.tariff_name = row.tariff_name.replace('SmartSaver Std 24hr', 'SmartSaver Plus 24hr'))],
  ['a fourth name is printed', (row) => (row.tariff_name += ' Standard Rate 24hr Off Peak')],
  ['a payment method is added', (row) => row.payment_methods.push({ method: 'on_receipt_ebill', phrase: 'Pay on receipt of e-bill' })],
  ['the price moves', (row) => (row.rates.unit_p_per_kwh = 41.2)]
]) {
  test(`the grouping decision stops applying when ${label}, and the row blocks again`, () => {
    const result = run({ mutate: (table) => mutate(groupedRow(table)) });
    assert.ok(!appliedIds(result).includes(GROUPING));
    assert.ok(result.decisions_unmatched.some((d) => d.decision_id === GROUPING));
    assert.ok(result.review_required.some((r) => r.reason === 'ambiguous_product_grouping'));
  });
}

for (const [label, mutate, pattern] of [
  ['a method the row does not print', (d) => (d.decision.products[0].payment_methods = ['direct_debit_ebill']), /does not print/],
  ['a printed method left unassigned', (d) => (d.decision.products[2].payment_methods = ['on_receipt_postal']), /unassigned/],
  ['a printed name left out', (d) => d.decision.products.pop(), /one entry per printed tariff name/],
  ['a name with no payment methods', (d) => (d.decision.products[0].payment_methods = []), /no payment methods/],
  ['no anchoring price', (d) => delete d.match.printed_rates, /printed_rates/],
  ['a single printed name', (d) => (d.match.printed_tariff_names = ['Standard Rate 24hr']), /two or more names/]
]) {
  test(`a grouping decision with ${label} is refused, not skipped`, () => {
    const decisions = shipped();
    mutate(decisions.decisions.find((d) => d.id === GROUPING));
    assert.throws(() => run({ decisions }), (err) => err instanceof MappingError && err.code === 'MALFORMED_DECISION' && pattern.test(err.message));
  });
}

// --- what a reviewer reads -------------------------------------------------

test('the source statement is read as the whole paragraph, not its first line', () => {
  const table = assembleTable(fixture(), 'standard');
  assert.match(table.source.statement, /^Prices for 12\/09\/2026 including VAT of 5%\./);
  assert.match(table.source.statement, /including VAT at 5%\)$/, 'the bracketed sentence must not be cut off');
});

test('the dataset note attributes to the source only what it printed', () => {
  const standardNotes = run().dataset.dataset.notes;
  assert.match(standardNotes, /The source states its comparisons do not factor in supplier incentives/);
  const e7 = mapToCanonical({
    table: assembleTable(JSON.parse(readFileSync('test/fixtures/consumer-council/economy7-text-items.json', 'utf8')), 'economy7'),
    previous: { dataset: JSON.parse(readFileSync('data/tariffs-2026-09-12.json', 'utf8')), label: 'x' },
    decisions: shipped()
  });
  // The Economy 7 table does not print that sentence, so its note must not say it does.
  assert.doesNotMatch(e7.dataset.dataset.notes, /The source states its comparisons do not factor/);
  assert.match(e7.dataset.dataset.notes, /does not state a day\/night split/);
});

test('a report with recorded decisions does not claim none were needed', () => {
  const report = reconcile({ candidate: run(), published: published() });
  const markdown = renderReconciliation(report);
  assert.doesNotMatch(markdown, /no value needed a human decision/);
  assert.match(markdown, /2 recorded human decisions were applied/);
  assert.match(markdown, /source discrepancy recorded/);
});
