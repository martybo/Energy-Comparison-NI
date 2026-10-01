/**
 * Maps assembled source rows to the canonical tariff records defined by
 * docs/DATA.md and enforced by src/validate.js.
 *
 * The central distinction, established by comparing the current PDFs against
 * the hand-audited 2026-09-12 dataset (issue #17):
 *
 *   Tier 1 — source-derived. Everything the PDF actually states: supplier,
 *     name, meter type, rates per payment method, headline discount, contract
 *     type/term/exit fee, eligibility, introductory period and its basis,
 *     explicit credits, status, the source's own wording, and provenance.
 *     Reproducible from the current document alone.
 *
 *   Tier 2 — persistent domain knowledge the PDF does not contain. Three
 *     things, and only these: `reverts_to` (the source never says what a
 *     fixed-term tariff reverts to), `discount_cap` structure (the Power NI
 *     rows state "Maximum of £60 savings per year" but not the £250-per-
 *     quarter / £1,000-per-year threshold the dataset models), and product
 *     grouping where one printed row covers several products.
 *
 * Tier 2 is carried forward from the previous canonical dataset, and only for
 * a product whose identity is demonstrably unchanged. It is never inferred for
 * a new product from a similar name, the same supplier, matching rates or
 * anything else: a new SSE fixed-term tariff does not acquire a `reverts_to`
 * because it resembles an existing one, and a new Power NI arrangement does
 * not inherit the £1,000 threshold because it is Power NI. That case becomes
 * an explicit review item instead.
 *
 * Every carried value is tagged `carried_forward` in field provenance and
 * recorded in a machine-readable audit entry naming the previous dataset,
 * the previous product, the field, why it was eligible, and whether the
 * current source contradicts it. A contradiction is never silently resolved
 * in favour of the old value.
 */

import { PAYMENT_METHOD_PHRASES } from './table.mjs';
import { MappingError } from './mapping-error.mjs';
import { decisionForRow, decisionsForFamily, printedLabel } from './decisions.mjs';

export { MappingError };

export const FIELD_PROVENANCE = {
  SOURCE_DERIVED: 'source_derived',
  CARRIED_FORWARD: 'carried_forward',
  NEEDS_REVIEW: 'needs_review',
  /** Established by a recorded human decision about this exact printed row
   *  (scripts/extract/source-decisions.json), not derived or inferred. */
  HUMAN_DECISION: 'human_decision'
};

/** The only fields permitted to be carried forward rather than source-derived. */
export const TIER_2_FIELDS = ['reverts_to', 'discount_cap', 'product_grouping'];

const METER_TYPE = { economy7: 'economy7', standard: 'standard' };

/**
 * The repository's existing id convention, verified to reproduce all 29 ids in
 * the 2026-09-12 Economy 7 dataset: the supplier slug is prefixed only when
 * the product name does not already begin with it.
 */
export function canonicalId(supplier, name) {
  const slug = (text) =>
    text
      .toLowerCase()
      .replace(/&amp;/g, 'and')
      .replace(/[.]/g, '-')
      .replace(/[%£()',]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  const supplierSlug = slug(supplier);
  const nameSlug = slug(name);
  return nameSlug.startsWith(supplierSlug) ? nameSlug : `${supplierSlug}-${nameSlug}`;
}

const normalise = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Tidies the source's wording into sentences without changing its meaning. */
function sourceNotes(text) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return null;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// --- Tier 1: what the source states ----------------------------------------

const RE = {
  percent: /(\d+(?:\.\d+)?)\s*%/,
  exitFee: /£\s*(\d+(?:\.\d+)?)\s*(?:early\s*)?exit\s*fee/i,
  noExitFee: /no\s*exit\s*fees?/i,
  variableContract: /variable\s*contract/i,
  fixedTerm: /fixed\s*term/i,
  noFixedTerm: /no\s*(?:fixed\s*term|contract)/i,
  oneYear: /\b1\s*year\b/i,
  months: /\b(\d+)\s*month\s*contract\b/i,
  newOnly: /(?:only\s*available\s*(?:for|to)\s*new\s*customers|available\s*to\s*new\s*customers\s*only|new\s*customers?\s*only|must\s*be\s*a\s*new\s*customer)/i,
  newAndExisting: /new\s*and\s*existing\s*customers/i,
  // Both wordings the source uses for a capped discount. The cap's structure
  // is Tier 2; this only detects that the source says one exists.
  savingsCap: /maximum(?:\s*of)?\s*(?:savings\s*of\s*)?£\s*(\d+(?:\.\d+)?)\s*(?:savings\s*)?per\s*year/i,
  startDate: /start\s*date:\s*(\d{2})\/(\d{2})\/(\d{4})/i
};

/**
 * Credits the source states, by the word it uses for them. The suppliers'
 * wordings differ — "£60 welcome credit", "£80 free credit", "£60 Energy
 * Credit" — and all are one-off money the customer receives.
 *
 * `welcome_credit` and `fixed_credit` are calculated identically (docs/DATA.md:
 * both are one-off and subtracted from the Year 1 total, never spread), so the
 * distinction here is descriptive: the source's own word decides it.
 */
const CREDIT_PATTERNS = [
  { pattern: /£\s*(\d+(?:\.\d+)?)\s*(?:welcome|sign[- ]?up)\s*credit/i, type: 'welcome_credit' },
  { pattern: /£\s*(\d+(?:\.\d+)?)\s*(?:loyalty|free|energy|bill|fuel)\s*credit/i, type: 'fixed_credit' },
  { pattern: /£\s*(\d+(?:\.\d+)?)\s*credit\b/i, type: 'fixed_credit' }
];

/** Any money the source mentions in the same breath as a credit. */
const CREDIT_MENTION = /£\s*\d+(?:\.\d+)?(?=[^.]{0,40}\bcredit\b)|(?<=\bcredit\b[^.]{0,40})£\s*\d+(?:\.\d+)?/gi;

/** Contract shape, as stated. Nothing is inferred when the source is silent. */
function deriveContract(info) {
  const noFixed = RE.noFixedTerm.test(info);
  const fixed = RE.fixedTerm.test(info) && !noFixed;
  const variable = RE.variableContract.test(info);

  let type = 'unknown';
  if (fixed) type = 'fixed';
  else if (variable || noFixed) type = 'variable';

  let termMonths = null;
  if (fixed) {
    // The term is as often printed in the tariff's name ("1 Year Home
    // Electricity 15% discount") as in the information column ("12 month
    // contract with no exit fee"), so both are read. It is still the source
    // stating it, not an inference.
    const months = RE.months.exec(info);
    if (months) termMonths = Number(months[1]);
    else if (RE.oneYear.test(info)) termMonths = 12;
  } else if (noFixed) termMonths = 0;

  let exitFee = null;
  const stated = RE.exitFee.exec(info);
  if (RE.noExitFee.test(info)) exitFee = 0;
  else if (stated) exitFee = Number(stated[1]);

  return { type, term_months: termMonths, exit_fee_gbp: exitFee };
}

/**
 * Introductory period and the basis for it. The four cases are exactly the
 * validator's, and each is evidenced by the audited dataset: a stated fixed
 * term, a stated absence of one, an advertised incentive with no stated
 * duration (null/unstated), and nothing advertised at all (0).
 */
function deriveIntroPeriod(info, { hasIncentive, contract }) {
  if (contract.type === 'fixed' && contract.term_months !== null) {
    return { intro_period_months: contract.term_months, intro_period_basis: 'stated_fixed_term' };
  }
  if (RE.noFixedTerm.test(info)) {
    return { intro_period_months: 0, intro_period_basis: 'stated_no_fixed_term' };
  }
  if (hasIncentive) {
    return { intro_period_months: null, intro_period_basis: 'unstated' };
  }
  return { intro_period_months: 0, intro_period_basis: 'no_incentive_advertised' };
}

/**
 * Credits the source states explicitly, and anything that looks like money
 * attached to a credit but matched no pattern.
 *
 * A percentage discount is never added as an adjustment: the Council prints
 * the already-discounted rate, so doing so would double-count it (the guard
 * documented in docs/DATA.md).
 *
 * Money the source states and the extraction cannot place is reported, never
 * dropped: a missed credit silently understates what the customer receives.
 */
function deriveAdjustments(info) {
  const adjustments = [];
  let remaining = info;
  for (const { pattern, type } of CREDIT_PATTERNS) {
    const match = pattern.exec(remaining);
    if (!match) continue;
    adjustments.push({ type, amount_gbp: Number(match[1]), applies: 'first_year', timing: 'unspecified' });
    remaining = `${remaining.slice(0, match.index)} ${remaining.slice(match.index + match[0].length)}`;
  }

  // The source may also state how a credit is paid in instalments
  // ("£80 free credit (£40 after switchover and £40 after month 9)"). The
  // schema's credit types are one-off by definition, so the total is carried
  // as one adjustment and the instalments stay in the transcribed notes —
  // those amounts are not additional money and must not be double-counted.
  const total = adjustments.reduce((sum, a) => sum + a.amount_gbp, 0);
  const unplaced = [...new Set((remaining.match(CREDIT_MENTION) ?? []).map((m) => m.replace(/\s+/g, '')))].filter(
    (mention) => Number(mention.slice(1)) > total
  );

  return { adjustments, unplaced_credit_amounts: unplaced };
}

function deriveTier1(row, familyId) {
  const info = row.additional_information;
  // The source states a tariff's terms in both printed columns: the term and
  // the credit are often in the name, the exit fee and eligibility in the
  // information column. Derivation reads both; `notes` still carries the
  // information column alone, as transcribed.
  const stated = `${row.tariff_name} ${info}`;
  const percent = RE.percent.exec(stated);
  const headline = percent ? Number(percent[1]) : null;
  const { adjustments, unplaced_credit_amounts } = deriveAdjustments(stated);
  const hasIncentive = headline !== null || adjustments.length > 0;
  const contract = deriveContract(stated);
  const intro = deriveIntroPeriod(stated, { hasIncentive, contract });

  let newCustomersOnly = null;
  if (RE.newOnly.test(stated)) newCustomersOnly = true;
  else if (RE.newAndExisting.test(stated)) newCustomersOnly = false;

  const startDate = RE.startDate.exec(stated);

  return {
    meter_type: METER_TYPE[familyId],
    status: 'active',
    // The Council prints the rate the customer actually pays, so an
    // advertised percentage means the printed rate is already discounted.
    rate_basis: headline === null ? 'standard' : 'discounted',
    headline_discount_pct: headline,
    ...intro,
    contract,
    eligibility: { new_customers_only: newCustomersOnly, notes: [] },
    adjustments,
    notes: sourceNotes(info),
    source_start_date: startDate ? `${startDate[3]}-${startDate[2]}-${startDate[1]}` : null,
    // Signals that the source indicates a capped discount whose *structure*
    // only Tier 2 can supply.
    states_savings_cap: RE.savingsCap.test(stated) ? Number(RE.savingsCap.exec(stated)[1]) : null,
    unplaced_credit_amounts
  };
}

/** Two printed rate cells are the same reading, to the printed precision. */
function sameRate(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'payment_method'));
  return [...keys].every((k) => a[k] === b[k]);
}

// --- product grouping -------------------------------------------------------

/**
 * Accounts for everything a TARIFF NAME cell prints.
 *
 * The cell may legitimately contain product names and, where the supplier
 * writes them there, payment-method phrases — Share Energy prints
 * "Share 24 Credit- Direct Debit e-bill" in the name column. Anything left
 * over after removing those is text we have not understood, and a name we
 * cannot account for means a product we would otherwise drop in silence.
 * That is the SSE Airtricity 24hr case: one price cell listing
 * "SmartSaver Std 24hr", "Keypad Standard Rate 24hr" and "Standard Rate 24hr"
 * against two payment phrases.
 */
/**
 * Wording that appears in a TARIFF NAME cell to say how the customer pays,
 * beyond the payment column's own phrases. Share Energy writes the method into
 * the name column — "Share Eco 7 Keypad", "Share Eco 7- Pay on receipt of bill
 * or e- bill" — and the 2026-09-12 audit reads those as one product priced per
 * method, not as separate products. These are the only words permitted to
 * stand in a name cell without naming a product.
 */
const NAME_CELL_PAYMENT_WORDS = ['Keypad', 'Prepayment', 'e-bill', 'postal bill', 'bill', 'or'];

/** Matches `text` allowing the wrapped-hyphen and extra spacing a cell wraps in. */
function tolerantPattern(text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/-/g, '-\\s*').replace(/ /g, '\\s+'), 'i');
}

function nameCellResidue(cell, chosenNames) {
  let remaining = cell;
  const consumeAll = (text) => {
    const pattern = tolerantPattern(text);
    for (;;) {
      const match = pattern.exec(remaining);
      if (!match) return;
      remaining = `${remaining.slice(0, match.index)} ${remaining.slice(match.index + match[0].length)}`;
    }
  };
  // A listed product's name is printed once per payment slot it covers, so
  // every occurrence is accounted for, not just the first. Longest first, so a
  // contained name cannot eat part of a longer one.
  const texts = [
    ...chosenNames,
    ...PAYMENT_METHOD_PHRASES.map((p) => p.phrase),
    ...NAME_CELL_PAYMENT_WORDS
  ].sort((a, b) => b.length - a.length);
  for (const text of texts) consumeAll(text);
  return remaining.replace(/[\s,;:.\u2013\u2014-]+/g, '').trim();
}

/**
 * Resolves which canonical products a printed row feeds.
 *
 * The explicit, testable rule: a row is one product named by its own tariff
 * cell. Where the previous dataset shows that this supplier's printed cell
 * actually covers several named products — the case the reconciliation
 * documents for SSE and Share Energy — that grouping is carried forward, with
 * payment methods allocated as the previous dataset recorded them. A row whose
 * printed names or payment methods cannot all be accounted for is a review
 * item, never a guess.
 */
function resolveProducts(row, previousProducts, decisions) {
  const cell = row.tariff_name;
  const directId = canonicalId(row.supplier, cell);

  // A recorded human decision about exactly this printed row is applied
  // before any matching of our own. It is authoritative because a person made
  // it with the evidence in front of them — but it is only ever applied, never
  // stretched: it matches this row's exact printed text or not at all.
  const decision = decisionForRow(decisions, row);
  if (decision?.kind === 'grouping') {
    const products = [];
    for (const entry of decision.decision.products) {
      // An existing product is named by id; a name the previous dataset does
      // not have becomes a product under the standard id convention.
      if (entry.product_id && !previousProducts.has(entry.product_id)) {
        return {
          kind: 'decision_not_applicable',
          products: [],
          decision,
          detail: { problem: 'target_missing', product_id: entry.product_id },
          message: `Recorded decision "${decision.id}" assigns "${entry.printed_name}" to product ${entry.product_id}, which the previous dataset does not contain. The decision cannot be applied, and the row has not been mapped some other way instead.`
        };
      }
      products.push({
        id: entry.product_id ?? canonicalId(row.supplier, entry.printed_name),
        name: normalise(entry.printed_name),
        methods: row.payment_methods.filter((m) => entry.payment_methods.includes(m.method)),
        sourceDiscrepancy: entry.source_discrepancy ?? null
      });
    }
    // One printed method the decision assigns to several names: say so, so
    // the slot accounting can show it rather than read it as a gained slot.
    const assignments = {};
    for (const product of products) for (const m of product.methods) assignments[m.method] = (assignments[m.method] ?? 0) + 1;
    const sharedSlots = Object.entries(assignments)
      .filter(([, n]) => n > 1)
      .map(([method, n]) => ({ payment_method: method, products: products.filter((p) => p.methods.some((m) => m.method === method)).map((p) => p.id), extra_rate_rows: n - 1 }));
    return { kind: 'decided_grouping', products, decision, sharedSlots };
  }
  if (decision) {
    const target = decision.decision.product_id;
    const prior = previousProducts.get(target) ?? null;
    if (!prior) {
      return {
        kind: 'decision_not_applicable',
        products: [],
        decision,
        detail: { problem: 'target_missing', product_id: target },
        message: `Recorded decision "${decision.id}" names product ${target}, which the previous dataset does not contain. The decision cannot be applied, and the row has not been mapped some other way instead.`
      };
    }
    if (previousProducts.has(directId) && directId !== target) {
      return {
        kind: 'decision_not_applicable',
        products: [],
        decision,
        detail: { problem: 'conflicts_with_direct_match', product_id: target, direct_match: directId },
        message: `Recorded decision "${decision.id}" says this row is ${target}, but its printed name is already the name of ${directId}. Neither has been preferred.`
      };
    }
    if (normalise(prior.name) === normalise(cell)) {
      // The published name already matches what is printed — the correction
      // the decision existed for has been published. Map it directly, and say
      // the decision can be retired.
      return { kind: 'direct', products: [{ id: target, name: cell, methods: row.payment_methods }], redundantDecision: decision };
    }
    return { kind: 'decided_identity', products: [{ id: target, name: cell, methods: row.payment_methods }], decision };
  }

  if (previousProducts.has(directId)) {
    return { kind: 'direct', products: [{ id: directId, name: cell, methods: row.payment_methods }] };
  }

  const candidates = [...previousProducts.values()]
    .filter((p) => p.supplier === row.supplier && cell.toLowerCase().includes(p.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);

  if (candidates.length === 0) {
    const residue = nameCellResidue(cell, [cell]);
    return { kind: 'new', products: [{ id: directId, name: cell, methods: row.payment_methods }], residue };
  }

  if (candidates.length === 1 && candidates[0].name === cell) {
    return { kind: 'direct', products: [{ id: candidates[0].id, name: cell, methods: row.payment_methods }] };
  }

  // The cell names one or more previous products. Allocate this row's printed
  // payment methods to them exactly as the previous dataset recorded, so the
  // grouping is inherited rather than re-derived.
  const chosen = [];
  const unallocated = new Set(row.payment_methods.map((p) => p.method));
  for (const candidate of candidates) {
    const methods = row.payment_methods.filter((p) => candidate.methods.includes(p.method) && unallocated.has(p.method));
    if (methods.length === 0) continue;
    for (const method of methods) unallocated.delete(method.method);
    chosen.push({ id: candidate.id, name: candidate.name, methods });
  }

  // Every printed payment method must land on a product, and every word of the
  // printed name cell must be accounted for by a chosen name or a payment
  // phrase. Either kind of leftover means the row is not understood.
  const residue = nameCellResidue(cell, chosen.map((c) => c.name));

  if (chosen.length === 0 || unallocated.size > 0 || residue !== '') {
    return {
      kind: 'ambiguous',
      products: [],
      detail: {
        cell,
        printed_name_lines: row.tariff_name_lines ?? [],
        candidates: candidates.map((c) => c.id),
        allocated: chosen.map((c) => ({ id: c.id, methods: c.methods.map((m) => m.method) })),
        unallocated_methods: [...unallocated],
        unaccounted_name_text: residue
      }
    };
  }

  return { kind: 'carried_grouping', products: chosen, carriedFrom: candidates.map((c) => c.id) };
}

/**
 * The dataset-level note. It says how the dataset was made and quotes the
 * source's own statement in full; anything it says the source states, the
 * source printed.
 */
function datasetNotes(familyId, source, decisionsApplied) {
  const table = familyId === 'economy7' ? 'Economy 7 Price Comparison Table' : 'Electricity Price Comparison Table';
  const parts = [
    `Extracted automatically from the Consumer Council ${table}, including its ADDITIONAL INFORMATION column.`,
    `The source states: "${source.statement}"`
  ];
  if (source.states_incentives_excluded) {
    parts.push(
      "The source states its comparisons do not factor in supplier incentives such as welcome credit; this dataset carries the credits the source describes as structured adjustments so the calculation engine can apply them."
    );
  } else {
    parts.push('Credits the source describes are carried as structured adjustments so the calculation engine can apply them.');
  }
  if (familyId === 'economy7' && source.typical_annual_kwh !== null) {
    parts.push(`The source states a typical annual consumption of ${source.typical_annual_kwh.toLocaleString('en-GB')} kWh but does not state a day/night split.`);
  }
  parts.push('Fields the source does not state are null (unknown), never inferred.');
  if (decisionsApplied.length > 0) {
    parts.push(
      `Where a printed row could not be resolved from the source alone, a recorded human decision says how it was resolved (${decisionsApplied.map((d) => d.decision_id).join(', ')}; scripts/extract/source-decisions.json).`
    );
  }
  return parts.join(' ');
}

// --- mapping ----------------------------------------------------------------

/**
 * Maps an assembled table to a candidate canonical dataset.
 *
 * `previous` is the current canonical dataset for this family (used only for
 * Tier 2 and grouping) plus the label identifying it for the audit trail.
 * Returns the candidate dataset, per-field provenance, the carry-forward
 * audit, and the review items that must be resolved by a person.
 */
export function mapToCanonical({ table, previous, decisions: decisionsFile = null }) {
  if (!table || !Array.isArray(table.rows) || table.rows.length === 0) {
    throw new MappingError('NO_SOURCE_ROWS', 'No assembled source rows to map');
  }
  const familyId = table.family;
  if (!METER_TYPE[familyId]) {
    throw new MappingError('UNKNOWN_FAMILY', `No meter type for tariff family "${familyId}"`, { familyId });
  }

  const previousDataset = previous?.dataset ?? null;
  const previousLabel = previous?.label ?? null;
  const previousProducts = new Map();
  for (const tariff of previousDataset?.tariffs ?? []) {
    previousProducts.set(tariff.id, {
      id: tariff.id,
      supplier: tariff.supplier,
      name: tariff.name,
      methods: tariff.rates.map((r) => r.payment_method),
      reverts_to: tariff.reverts_to ?? null,
      discount_cap: tariff.adjustments?.find((a) => a.type === 'discount_cap') ?? null,
      intro_period_basis: tariff.intro_period_basis,
      status: tariff.status
    });
  }

  const decisions = decisionsForFamily(decisionsFile, familyId);
  const decisionsApplied = [];
  const decisionsRedundant = [];
  const sharedSlots = [];
  const decisionsMatched = new Set();

  const products = new Map();
  const fieldProvenance = {};
  const carryForwardAudit = [];
  const reviewRequired = [];
  const sourceRowTrace = [];
  const repeatedSlots = [];

  const rateFor = (row) =>
    familyId === 'economy7'
      ? { day_p_per_kwh: row.rates.day_p_per_kwh, night_p_per_kwh: row.rates.night_p_per_kwh, standing_p_per_day: row.rates.standing_p_per_day }
      : { unit_p_per_kwh: row.rates.unit_p_per_kwh, standing_p_per_day: row.rates.standing_p_per_day };

  for (const row of table.rows) {
    const resolution = resolveProducts(row, previousProducts, decisions);
    if (resolution.decision) decisionsMatched.add(resolution.decision.id);
    if (resolution.redundantDecision) {
      decisionsMatched.add(resolution.redundantDecision.id);
      decisionsRedundant.push({
        decision_id: resolution.redundantDecision.id,
        product_id: resolution.redundantDecision.decision.product_id,
        message: 'The previous dataset already records the printed name, so this decision is no longer needed and can be removed from the decisions file.'
      });
    }

    if (resolution.kind === 'decision_not_applicable') {
      reviewRequired.push({
        reason: 'decision_not_applicable',
        field: 'product_identity',
        source_row: row.index,
        page: row.page,
        supplier: row.supplier,
        printed_tariff_cell: row.tariff_name,
        decision_id: resolution.decision.id,
        detail: resolution.detail,
        unresolved_slots: row.payment_methods.length,
        message: resolution.message
      });
      sourceRowTrace.push([row.page, row.payment_methods.length, []]);
      continue;
    }

    if (resolution.kind === 'ambiguous') {
      reviewRequired.push({
        reason: 'ambiguous_product_grouping',
        field: 'product_grouping',
        source_row: row.index,
        page: row.page,
        supplier: row.supplier,
        printed_tariff_cell: row.tariff_name,
        detail: resolution.detail,
        // Every slot the row prints is unresolved, not only those a would-be
        // allocation happened to reach.
        unresolved_slots: row.payment_methods.length,
        message:
          'This printed row appears to cover more than one product and no grouping could be inherited for it. A person must decide how its payment methods map to products; it has not been guessed.'
      });
      sourceRowTrace.push([row.page, row.payment_methods.length, []]);
      continue;
    }

    if (resolution.kind === 'decided_grouping') {
      decisionsApplied.push({
        decision_id: resolution.decision.id,
        kind: 'grouping',
        printed_names: resolution.decision.match.printed_tariff_names,
        printed_payment_methods: row.payment_methods.map((m) => m.method),
        products: resolution.products.map((p) => ({ product_id: p.id, printed_name: p.name, payment_methods: p.methods.map((m) => m.method) })),
        source_discrepancies: resolution.products
          .filter((p) => p.sourceDiscrepancy)
          .map((p) => ({ product_id: p.id, discrepancy: p.sourceDiscrepancy })),
        source_row: row.index,
        page: row.page,
        decided_by: resolution.decision.decided_by,
        reason: resolution.decision.reason
      });
      for (const shared of resolution.sharedSlots) {
        sharedSlots.push({ ...shared, source_row: row.index, page: row.page, decision_id: resolution.decision.id });
      }
    }

    const tier1 = deriveTier1(row, familyId);
    const ids = [];

    for (const target of resolution.products) {
      ids.push(target.id);
      const rates = target.methods.map((method) => ({ payment_method: method.method, ...rateFor(row) }));

      if (products.has(target.id)) {
        // Several printed rows feed one product. Two distinct cases, and they
        // must not be confused: Share Energy prints one product's payment
        // methods across two rows (new methods, which are added), while a row
        // straddling a page break has its name, method and price reprinted on
        // the next page (an identical repeat, which adds nothing). A repeated
        // payment method at a *different* price is neither, and is never
        // reconciled by keeping whichever row came first.
        const existing = products.get(target.id);
        for (const rate of rates) {
          const prior = existing.record.rates.find((r) => r.payment_method === rate.payment_method);
          if (!prior) {
            existing.record.rates.push(rate);
            continue;
          }
          if (sameRate(prior, rate)) {
            repeatedSlots.push({
              product_id: target.id,
              payment_method: rate.payment_method,
              printed_again_on_page: row.page,
              source_row: row.index,
              reason: 'page_break_repeat',
              message:
                'This payment method and price are printed twice for the same product, on consecutive pages. Counted once; the repeat contributes no new rate.'
            });
            continue;
          }
          reviewRequired.push({
            reason: 'conflicting_rate_for_payment_method',
            field: 'rates',
            product_id: target.id,
            source_row: row.index,
            page: row.page,
            payment_method: rate.payment_method,
            first_seen: prior,
            printed_again: rate,
            message:
              'The source prints two different prices for the same product and payment method. Neither has been preferred: a person must determine which the source intends.'
          });
        }
        existing.rows.push(row.index);
        continue;
      }

      const record = {
        id: target.id,
        supplier: row.supplier,
        name: target.name,
        meter_type: tier1.meter_type,
        status: tier1.status,
        rate_basis: tier1.rate_basis,
        headline_discount_pct: tier1.headline_discount_pct,
        intro_period_months: tier1.intro_period_months,
        intro_period_basis: tier1.intro_period_basis,
        reverts_to: null,
        contract: tier1.contract,
        eligibility: tier1.eligibility,
        rates,
        adjustments: [...tier1.adjustments],
        notes: tier1.notes
      };

      const provenance = {};
      for (const field of [
        'supplier',
        'name',
        'meter_type',
        'status',
        'rate_basis',
        'headline_discount_pct',
        'intro_period_months',
        'intro_period_basis',
        'contract',
        'eligibility',
        'rates',
        'notes'
      ]) {
        provenance[field] = FIELD_PROVENANCE.SOURCE_DERIVED;
      }

      if (resolution.kind === 'decided_grouping') {
        // Which payment methods this printed name takes is a recorded human
        // decision; everything else about the record is still the source's.
        provenance.product_grouping = FIELD_PROVENANCE.HUMAN_DECISION;
      }

      if (resolution.kind === 'decided_identity') {
        // The name is still exactly what the source prints; only the link to
        // the previous product comes from the decision, and it is tagged so.
        provenance.product_identity = FIELD_PROVENANCE.HUMAN_DECISION;
        const before = previousProducts.get(target.id);
        decisionsApplied.push({
          decision_id: resolution.decision.id,
          kind: resolution.decision.kind,
          product_id: target.id,
          previous_name: before.name,
          printed_name: row.tariff_name,
          source_row: row.index,
          page: row.page,
          decided_by: resolution.decision.decided_by,
          reason: resolution.decision.reason
        });
      }

      if (tier1.unplaced_credit_amounts.length > 0) {
        reviewRequired.push({
          reason: 'unplaced_credit_amount',
          field: 'adjustments',
          product_id: target.id,
          source_row: row.index,
          page: row.page,
          amounts: tier1.unplaced_credit_amounts,
          extracted_total_gbp: tier1.adjustments.reduce((sum, a) => sum + a.amount_gbp, 0),
          message:
            'The source states money alongside the word "credit" that the extraction could not place in an adjustment. It has not been guessed at or ignored: a person must decide what the customer actually receives.'
        });
      }

      const prior = previousProducts.get(target.id) ?? null;

      // --- Tier 2: reverts_to -------------------------------------------
      const needsReverts = record.intro_period_basis === 'stated_fixed_term' && record.intro_period_months > 0;
      if (needsReverts) {
        if (prior?.reverts_to) {
          record.reverts_to = prior.reverts_to;
          provenance.reverts_to = FIELD_PROVENANCE.CARRIED_FORWARD;
          carryForwardAudit.push({
            product_id: target.id,
            field: 'reverts_to',
            value: prior.reverts_to,
            previous_dataset: previousLabel,
            previous_product_id: prior.id,
            eligible_because:
              resolution.kind === 'decided_identity'
                ? `Product identity established by recorded decision "${resolution.decision.id}" (${resolution.decision.decided_by}): the printed name differs from the previous dataset's, and a person has recorded, with evidence, that it is the same product. The source still states a fixed term.`
                : 'Product identity unchanged: same canonical id, supplier and name in the previous dataset, and the source still states a fixed term.',
            identity_basis: resolution.kind === 'decided_identity' ? `decision:${resolution.decision.id}` : 'same_id_supplier_and_name',
            source_provides_value: false,
            source_contradicts: false
          });
        } else {
          provenance.reverts_to = FIELD_PROVENANCE.NEEDS_REVIEW;
          reviewRequired.push({
            reason: prior ? 'tier2_missing_for_existing_product' : 'tier2_missing_for_new_product',
            field: 'reverts_to',
            product_id: target.id,
            source_row: row.index,
            page: row.page,
            message:
              'The source states a fixed term but never says which tariff this reverts to, and no value could be carried forward for this product. Not inferred from a similar product: a person must supply it, or the ongoing cost stays unknown.'
          });
        }
      }

      // --- Tier 2: discount_cap -----------------------------------------
      if (tier1.states_savings_cap !== null) {
        if (prior?.discount_cap) {
          const carried = { ...prior.discount_cap };
          const contradicts =
            carried.max_saving_gbp !== undefined && carried.max_saving_gbp !== tier1.states_savings_cap;
          if (contradicts) {
            provenance.discount_cap = FIELD_PROVENANCE.NEEDS_REVIEW;
            reviewRequired.push({
              reason: 'carried_value_contradicted_by_source',
              field: 'discount_cap',
              product_id: target.id,
              source_row: row.index,
              page: row.page,
              carried_max_saving_gbp: carried.max_saving_gbp,
              source_max_saving_gbp: tier1.states_savings_cap,
              message:
                'The source now states a different maximum saving from the carried discount cap. The old value has not been retained: a person must re-establish the cap structure.'
            });
            carryForwardAudit.push({
              product_id: target.id,
              field: 'discount_cap',
              value: null,
              previous_dataset: previousLabel,
              previous_product_id: prior.id,
              eligible_because: 'Rejected: the current source contradicts the carried value.',
              source_provides_value: true,
              source_contradicts: true
            });
          } else {
            record.adjustments.push(carried);
            provenance.discount_cap = FIELD_PROVENANCE.CARRIED_FORWARD;
            carryForwardAudit.push({
              product_id: target.id,
              field: 'discount_cap',
              value: carried,
              previous_dataset: previousLabel,
              previous_product_id: prior.id,
              eligible_because:
                'Product identity unchanged and the maximum saving the source states still matches the carried cap; the source states the cap exists but not its threshold structure.',
              source_provides_value: false,
              source_contradicts: false
            });
          }
        } else {
          provenance.discount_cap = FIELD_PROVENANCE.NEEDS_REVIEW;
          reviewRequired.push({
            reason: prior ? 'tier2_missing_for_existing_product' : 'tier2_missing_for_new_product',
            field: 'discount_cap',
            product_id: target.id,
            source_row: row.index,
            page: row.page,
            source_max_saving_gbp: tier1.states_savings_cap,
            message:
              'The source states a capped maximum saving but not the threshold structure the calculator needs, and none could be carried forward. Not inherited from another tariff of the same supplier: a person must establish it.'
          });
        }
      }

      // A Tier-2 value the previous dataset held must not disappear because a
      // wording changed and a signal stopped matching. Losing it silently is
      // the failure this whole layer exists to prevent, so it is a gate.
      if (prior?.discount_cap && !record.adjustments.some((a) => a.type === 'discount_cap')) {
        provenance.discount_cap = FIELD_PROVENANCE.NEEDS_REVIEW;
        reviewRequired.push({
          reason: 'carried_value_lost',
          field: 'discount_cap',
          product_id: target.id,
          source_row: row.index,
          page: row.page,
          previous_value: prior.discount_cap,
          message:
            'The previous dataset records a capped discount for this product but the current source wording no longer signals one. The old cap has not been retained on an unverified basis, and its absence is not treated as the source withdrawing it: a person must confirm which it is.'
        });
      }
      if (prior?.reverts_to && record.reverts_to === null && provenance.reverts_to === undefined) {
        provenance.reverts_to = FIELD_PROVENANCE.NEEDS_REVIEW;
        reviewRequired.push({
          reason: 'carried_value_lost',
          field: 'reverts_to',
          product_id: target.id,
          source_row: row.index,
          page: row.page,
          previous_value: prior.reverts_to,
          message:
            'The previous dataset records what this tariff reverts to, but the current source no longer states a fixed term for it. A person must confirm whether the tariff has become open-ended or the wording simply changed.'
        });
      }

      if (resolution.kind === 'carried_grouping') {
        provenance.product_grouping = FIELD_PROVENANCE.CARRIED_FORWARD;
        carryForwardAudit.push({
          product_id: target.id,
          field: 'product_grouping',
          value: { printed_cell: row.tariff_name, methods: target.methods.map((m) => m.method) },
          previous_dataset: previousLabel,
          previous_product_id: target.id,
          eligible_because:
            'One printed row names several products; the previous dataset records how its payment methods divide between them and the same products are still named.',
          source_provides_value: false,
          source_contradicts: false
        });
      }

      products.set(target.id, { record, provenance, rows: [row.index] });
      fieldProvenance[target.id] = provenance;
    }

    sourceRowTrace.push([row.page, row.payment_methods.length, ids]);
  }

  // Withdrawn products: named by a removal notice, no longer priced.
  for (const notice of table.notices.filter((n) => n.kind === 'section_notice')) {
    const noticeSupplier = notice.heading.replace(/\s*tariff removal\s*$/i, '').trim();
    for (const name of notice.listed) {
      // Identity by supplier and printed name, as for a priced row: the
      // previous dataset's id is reused when it names the same product, so a
      // withdrawal does not create a near-duplicate id. The ids the previous
      // dataset gave Click Energy's Twilight tariffs carry a "-std"
      // disambiguator that the convention alone would not produce, and
      // re-deriving the id would silently retire one product and invent
      // another.
      const prior =
        [...previousProducts.values()].find(
          (p) => p.supplier.toLowerCase() === noticeSupplier.toLowerCase() && p.name.toLowerCase() === name.toLowerCase()
        ) ?? null;
      const supplier = prior?.supplier ?? noticeSupplier;
      const id = prior?.id ?? canonicalId(supplier, name);
      if (products.has(id)) continue;

      // A removal notice says the tariff is no longer available. It says
      // nothing about its terms, so those are retained from the previous
      // record rather than reasserted as unknown or as "no incentive
      // advertised" — the notice is evidence about availability only. The
      // retention is audited like any other carried value.
      const retained = previousDataset?.tariffs?.find((t) => t.id === id) ?? null;
      const noticeNotes = sourceNotes(`${notice.heading}. ${notice.text}`);
      const provenance = { status: FIELD_PROVENANCE.SOURCE_DERIVED, name: FIELD_PROVENANCE.SOURCE_DERIVED };

      if (retained) {
        for (const field of ['rate_basis', 'headline_discount_pct', 'intro_period_months', 'intro_period_basis', 'reverts_to', 'contract', 'eligibility', 'adjustments']) {
          provenance[field] = FIELD_PROVENANCE.CARRIED_FORWARD;
        }
        carryForwardAudit.push({
          product_id: id,
          field: 'withdrawn_product_terms',
          value: { retained_from_status: retained.status },
          previous_dataset: previousLabel,
          previous_product_id: retained.id,
          eligible_because:
            'The source prints a removal notice naming this tariff and no longer prices it. The notice is evidence about availability, not about the tariff\'s terms, so the previously recorded terms are retained unchanged alongside the new status.',
          source_provides_value: false,
          source_contradicts: false
        });
      }

      products.set(id, {
        record: retained
          ? { ...retained, status: 'withdrawn', rates: [], notes: noticeNotes }
          : {
              id,
              supplier,
              name,
              meter_type: METER_TYPE[familyId],
              status: 'withdrawn',
              rate_basis: 'standard',
              headline_discount_pct: null,
              intro_period_months: null,
              intro_period_basis: 'unstated',
              reverts_to: null,
              contract: { type: 'unknown', term_months: null, exit_fee_gbp: null },
              eligibility: { new_customers_only: null, notes: [] },
              rates: [],
              adjustments: [],
              notes: noticeNotes
            },
        provenance,
        rows: []
      });
      fieldProvenance[id] = provenance;
    }
  }

  const tariffs = [...products.values()].map((p) => p.record);

  const dataset = {
    effective_from: table.source.comparison_date,
    published: table.source.comparison_date,
    source: `Consumer Council for Northern Ireland - ${familyId === 'economy7' ? 'Economy 7 Price Comparison Table' : 'Electricity Price Comparison Table'}`,
    source_url: previousDataset?.dataset?.source_url ?? null,
    source_pdf_url: previous?.pdf_url ?? previousDataset?.dataset?.source_pdf_url ?? null,
    vat_treatment: table.source.vat_treatment,
    rate_unit: 'pence_per_kwh',
    standing_unit: 'pence_per_day',
    currency: 'GBP',
    typical_annual_kwh: table.source.typical_annual_kwh,
    conditions_verified: true,
    conditions_verified_meaning:
      'The source ADDITIONAL INFORMATION column was transcribed for every record. It does not mean every condition is known: fields the source leaves unstated remain null on the individual tariff.',
    notes: datasetNotes(familyId, table.source, decisionsApplied)
  };

  return {
    family: familyId,
    dataset: { dataset, tariffs },
    source_row_trace: sourceRowTrace,
    field_provenance: fieldProvenance,
    carry_forward_audit: carryForwardAudit,
    repeated_slots: repeatedSlots,
    decisions_applied: decisionsApplied,
    decisions_redundant: decisionsRedundant,
    // A decision that matched no printed row: the Council has changed the row
    // it was made about, so it no longer applies. Not a failure in itself —
    // whatever the row now says is resolved, or gated, on its own terms.
    decisions_unmatched: decisions
      .filter((d) => !decisionsMatched.has(d.id))
      .map((d) => ({ decision_id: d.id, supplier: d.match.supplier, printed_tariff_name: printedLabel(d) })),
    shared_slots: sharedSlots,
    review_required: reviewRequired,
    totals: {
      source_rows: table.rows.length,
      payment_method_slots: table.totals.payment_method_slots,
      products: tariffs.length,
      active: tariffs.filter((t) => t.status === 'active').length,
      withdrawn: tariffs.filter((t) => t.status === 'withdrawn').length,
      rate_rows: tariffs.reduce((sum, t) => sum + t.rates.length, 0),
      repeated_slots: repeatedSlots.length,
      slots_shared_by_decision: sharedSlots.reduce((sum, shared) => sum + shared.extra_rate_rows, 0),
      carried_forward_values: carryForwardAudit.filter((a) => !a.source_contradicts).length,
      review_items: reviewRequired.length
    }
  };
}
