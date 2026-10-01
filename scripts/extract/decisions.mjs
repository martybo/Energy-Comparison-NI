/**
 * Recorded human decisions about specific printed rows of the source.
 *
 * The mapper never infers a product's identity or grouping from similarity.
 * Where the source genuinely cannot be resolved from the document alone, a
 * person decides, and the decision is recorded here: what was printed, what
 * was decided, and the evidence for it. The pipeline then applies that
 * decision deterministically — it does not make one.
 *
 * Every decision is source-specific, not a general rule. It is anchored to
 * the exact printed content of the row it was made about, so if the Council
 * changes that row the decision simply stops matching, the row is not
 * understood again, and the run blocks for a fresh decision rather than
 * carrying an old one onto a new situation.
 *
 * Kinds:
 *
 *   identity — a printed tariff name is the same product as one in the
 *     previous dataset, under a name the previous dataset recorded
 *     differently. The product keeps its id; its name becomes what the
 *     source prints.
 *
 *   grouping — one printed row lists several tariff names against payment
 *     methods without pairing them. The decision states which printed names
 *     take which printed payment methods. It may assign one printed method to
 *     more than one name; that is recorded as a shared slot, not hidden.
 *
 * Any other kind is refused: a decision the mapper does not know how to
 * apply must not be silently ignored.
 */

import { MappingError } from './mapping-error.mjs';

export const DECISION_KINDS = ['identity', 'grouping'];

const normalise = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/**
 * Validates the decisions file and returns those for one tariff family. A
 * malformed decision is an extraction failure, not a skipped entry: a typo in
 * a recorded decision must not quietly turn it off.
 */
export function decisionsForFamily(file, familyId) {
  if (file === null || file === undefined) return [];
  if (typeof file !== 'object' || !Array.isArray(file.decisions)) {
    throw new MappingError('MALFORMED_DECISIONS', 'The source decisions file must be an object with a "decisions" array');
  }

  const seen = new Set();
  const valid = [];
  for (const [index, decision] of file.decisions.entries()) {
    const where = `source decision ${index + 1}${decision?.id ? ` ("${decision.id}")` : ''}`;
    const fail = (message) => {
      throw new MappingError('MALFORMED_DECISION', `${where}: ${message}`, { index, decision });
    };

    if (typeof decision?.id !== 'string' || decision.id === '') fail('needs a non-empty "id"');
    if (seen.has(decision.id)) fail('duplicates the id of an earlier decision');
    seen.add(decision.id);
    if (!DECISION_KINDS.includes(decision.kind)) fail(`has unknown kind "${decision.kind}"; known kinds are ${DECISION_KINDS.join(', ')}`);
    if (typeof decision.family !== 'string') fail('needs a "family"');

    const match = decision.match ?? {};
    if (typeof match.supplier !== 'string' || match.supplier === '') fail('needs match.supplier');
    if (!Array.isArray(match.printed_payment_methods) || match.printed_payment_methods.length === 0) {
      fail('needs match.printed_payment_methods');
    }
    if (match.printed_rates !== undefined && (typeof match.printed_rates !== 'object' || match.printed_rates === null)) {
      fail('match.printed_rates, when given, must be an object of rate fields');
    }

    const outcome = decision.decision ?? {};
    if (decision.kind === 'identity') {
      if (typeof match.printed_tariff_name !== 'string' || match.printed_tariff_name === '') fail('needs match.printed_tariff_name');
      if (typeof outcome.product_id !== 'string' || outcome.product_id === '') fail('needs decision.product_id');
      if (normalise(outcome.canonical_name) !== normalise(match.printed_tariff_name)) {
        // The whole point of an identity decision is that the source's own
        // wording becomes the name. A decision that renamed the product to
        // something the source does not print would be an inference.
        fail('decision.canonical_name must be exactly the printed tariff name');
      }
    }

    if (decision.kind === 'grouping') {
      const names = match.printed_tariff_names;
      if (!Array.isArray(names) || names.length < 2 || names.some((n) => typeof n !== 'string' || n.trim() === '')) {
        fail('needs match.printed_tariff_names: the two or more names the row prints');
      }
      if (new Set(names.map(normalise)).size !== names.length) fail('lists a printed tariff name twice');
      if (names.length > 6) fail('lists more printed names than a single row can sensibly be matched against');
      // A grouping decision rests on the row's one printed price, so it is
      // anchored to that price: if the price moves, the row is decided again.
      if (!match.printed_rates || Object.keys(match.printed_rates).length === 0) fail('needs match.printed_rates');

      const products = outcome.products;
      if (!Array.isArray(products) || products.length !== names.length) {
        fail('decision.products must give exactly one entry per printed tariff name');
      }
      const decidedNames = products.map((p) => normalise(p?.printed_name));
      if (!sameSet(decidedNames, names.map(normalise))) fail('decision.products must name each printed tariff name exactly once');
      const covered = new Set();
      for (const product of products) {
        if (!Array.isArray(product.payment_methods) || product.payment_methods.length === 0) {
          fail(`gives "${product.printed_name}" no payment methods; a printed name the decision cannot price must not be listed as decided`);
        }
        for (const method of product.payment_methods) {
          if (!match.printed_payment_methods.includes(method)) {
            fail(`assigns "${method}" to "${product.printed_name}", but the row does not print that payment method`);
          }
          covered.add(method);
        }
        if (product.product_id !== undefined && (typeof product.product_id !== 'string' || product.product_id === '')) {
          fail(`gives "${product.printed_name}" an empty product_id`);
        }
      }
      const uncovered = match.printed_payment_methods.filter((m) => !covered.has(m));
      if (uncovered.length > 0) fail(`leaves printed payment method(s) ${uncovered.join(', ')} unassigned`);
    }

    for (const field of ['decided_by', 'reason']) {
      if (typeof decision[field] !== 'string' || decision[field].trim() === '') fail(`needs "${field}": who decided, and why`);
    }
    if (typeof decision.evidence !== 'object' || decision.evidence === null) fail('needs "evidence"');

    if (decision.family === familyId) valid.push(decision);
  }
  return valid;
}

/**
 * Whether a decision's printed names are exactly what this row prints.
 *
 * An identity decision names one tariff. A grouping decision names a set: the
 * Council has printed the same three names in different bullet orders in
 * different months (12/09/2026 and 30/09/2026), and the order carries no
 * meaning, so any order of exactly those names — and nothing else — matches.
 */
function namesMatch(decision, row) {
  const cell = normalise(row.tariff_name);
  if (decision.kind === 'identity') return normalise(decision.match.printed_tariff_name) === cell;
  return permutations(decision.match.printed_tariff_names.map(normalise)).some((order) => order.join(' ') === cell);
}

/** The decision, if any, made about exactly this printed row. */
export function decisionForRow(decisions, row) {
  const matches = decisions.filter((decision) => {
    const match = decision.match;
    if (match.supplier !== row.supplier) return false;
    if (!namesMatch(decision, row)) return false;
    if (!sameSet(match.printed_payment_methods, row.payment_methods.map((p) => p.method))) return false;
    if (match.printed_rates) {
      for (const [field, value] of Object.entries(match.printed_rates)) {
        if (row.rates[field] !== value) return false;
      }
    }
    return true;
  });
  if (matches.length > 1) {
    throw new MappingError(
      'CONFLICTING_DECISIONS',
      `${matches.length} recorded decisions match the same printed row (${row.supplier}, "${row.tariff_name}"): ${matches.map((d) => d.id).join(', ')}`,
      { decisions: matches.map((d) => d.id) }
    );
  }
  return matches[0] ?? null;
}

/** Display label for a decision's printed name(s). */
export function printedLabel(decision) {
  return decision.kind === 'grouping' ? decision.match.printed_tariff_names.join(' / ') : decision.match.printed_tariff_name;
}
