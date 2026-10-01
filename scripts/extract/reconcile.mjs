/**
 * Compares a candidate canonical dataset against the one currently published
 * and reports every difference, so a person reviewing the candidate PR can see
 * what changed without reading the PDF or the JSON diff.
 *
 * The report is deliberately not a summary. A month in which nothing material
 * changed should say so in one line; a month in which a tariff was withdrawn,
 * a rate moved or a product was renamed should name it, field by field, with
 * the source row it came from. Anything the extraction could not resolve is
 * listed as a gate, not a footnote: the candidate is not publishable while a
 * gate is open.
 */

import { validateDataset } from '../../src/validate.js';

const RATE_FIELDS = ['unit_p_per_kwh', 'day_p_per_kwh', 'night_p_per_kwh', 'standing_p_per_day'];

/** Scalar and small-structure fields whose change is worth naming explicitly. */
const COMPARED_FIELDS = [
  'name',
  'supplier',
  'status',
  'rate_basis',
  'headline_discount_pct',
  'intro_period_months',
  'intro_period_basis',
  'reverts_to',
  'notes'
];

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * `notes` is the source's ADDITIONAL INFORMATION column, transcribed. The
 * published datasets were transcribed by hand and lightly punctuated into
 * sentences, so almost every record's notes differ in wording from a faithful
 * extraction while saying the same thing. A reviewer needs to see the rates,
 * terms and credits that moved without those wording changes burying them, so
 * a record whose only difference is `notes` is reported separately — listed,
 * never hidden.
 */
const isWordingOnly = (fields, rates) =>
  rates.added.length === 0 &&
  rates.removed.length === 0 &&
  rates.repriced.length === 0 &&
  fields.length > 0 &&
  fields.every((f) => f.field === 'notes');

function rateByMethod(tariff) {
  const map = new Map();
  for (const rate of tariff.rates ?? []) map.set(rate.payment_method, rate);
  return map;
}

/** Rate-level differences for one product: methods added, removed, repriced. */
function diffRates(before, after) {
  const was = rateByMethod(before);
  const now = rateByMethod(after);
  const added = [...now.keys()].filter((m) => !was.has(m));
  const removed = [...was.keys()].filter((m) => !now.has(m));
  const repriced = [];

  for (const [method, rate] of now) {
    const prior = was.get(method);
    if (!prior) continue;
    for (const field of RATE_FIELDS) {
      if (rate[field] === undefined && prior[field] === undefined) continue;
      if (rate[field] !== prior[field]) {
        repriced.push({ payment_method: method, field, from: prior[field] ?? null, to: rate[field] ?? null });
      }
    }
  }

  return { added, removed, repriced };
}

/**
 * A product present in one dataset and not the other may be genuinely new or
 * withdrawn, or the same product under a changed printed name. The pairing is
 * reported as a *suspected* rename and never acted on: it exists so a reviewer
 * is not left comparing two unexplained lists, and the mapper has already
 * refused to carry domain knowledge across it.
 */
function suspectRenames(removed, added) {
  const pairs = [];
  const takenAdded = new Set();
  for (const gone of removed) {
    const match = added.find(
      (candidate) =>
        !takenAdded.has(candidate.id) &&
        candidate.supplier === gone.supplier &&
        sameValue(
          (candidate.rates ?? []).map((r) => r.payment_method).sort(),
          (gone.rates ?? []).map((r) => r.payment_method).sort()
        )
    );
    if (!match) continue;
    takenAdded.add(match.id);
    pairs.push({
      previous_id: gone.id,
      previous_name: gone.name,
      candidate_id: match.id,
      candidate_name: match.name,
      same_payment_methods: (match.rates ?? []).map((r) => r.payment_method),
      basis:
        'Same supplier and the same set of payment methods. The printed name differs, so identity is not assumed: the candidate carries no domain knowledge from the previous product.'
    });
  }
  return pairs;
}

/**
 * `candidate` is a `mapToCanonical` result; `published` is the dataset file it
 * is proposed to replace, or null for a family with nothing published yet.
 */
export function reconcile({ candidate, published, publishedLabel = null }) {
  const previous = new Map((published?.tariffs ?? []).map((t) => [t.id, t]));
  const current = new Map(candidate.dataset.tariffs.map((t) => [t.id, t]));

  const added = [...current.values()].filter((t) => !previous.has(t.id));
  const missing = [...previous.values()].filter((t) => !current.has(t.id));

  // A published product absent from the candidate is not necessarily gone. If
  // the source still prints it inside a row awaiting a decision, it is
  // unresolved, and reporting it as "no longer present" would read to a
  // reviewer as a withdrawal the Council never made.
  const unresolvedItems = candidate.review_required.filter((item) => (item.unresolved_slots ?? 0) > 0);
  const awaitingIds = new Set();
  for (const item of unresolvedItems) {
    for (const id of item.detail?.candidates ?? []) awaitingIds.add(id);
    if (item.detail?.product_id) awaitingIds.add(item.detail.product_id);
  }
  const lower = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const printedInUnresolvedRow = (tariff) =>
    awaitingIds.has(tariff.id) ||
    unresolvedItems.some((item) => item.supplier === tariff.supplier && lower(item.printed_tariff_cell).includes(lower(tariff.name)));
  const awaitingDecision = missing.filter(printedInUnresolvedRow);
  const removed = missing.filter((t) => !printedInUnresolvedRow(t));
  const changed = [];
  const wordingOnly = [];
  const unchanged = [];

  for (const [id, after] of current) {
    const before = previous.get(id);
    if (!before) continue;

    const fields = [];
    for (const field of COMPARED_FIELDS) {
      if (!sameValue(before[field], after[field])) fields.push({ field, from: before[field] ?? null, to: after[field] ?? null });
    }
    for (const field of ['contract', 'eligibility', 'adjustments']) {
      if (!sameValue(before[field], after[field])) fields.push({ field, from: before[field] ?? null, to: after[field] ?? null });
    }
    const rates = diffRates(before, after);
    const rateChanged = rates.added.length > 0 || rates.removed.length > 0 || rates.repriced.length > 0;

    if (fields.length === 0 && !rateChanged) {
      unchanged.push(id);
      continue;
    }
    const entry = { id, supplier: after.supplier, name: after.name, fields, rates };
    if (isWordingOnly(fields, rates)) wordingOnly.push(entry);
    else changed.push(entry);
  }

  const datasetFields = [];
  for (const [field, value] of Object.entries(candidate.dataset.dataset)) {
    const before = published?.dataset?.[field];
    if (before !== undefined && !sameValue(before, value)) datasetFields.push({ field, from: before, to: value });
  }

  const printedSlots = candidate.totals.payment_method_slots;
  const mappedRates = candidate.totals.rate_rows;
  const repeats = candidate.repeated_slots?.length ?? 0;
  // Each printed row the mapper could not resolve leaves all of its printed
  // slots unresolved, and says how many.
  const unresolvedSlots = candidate.review_required.reduce((sum, item) => sum + (item.unresolved_slots ?? 0), 0);

  // The integrity check that makes the rest of the report trustworthy: every
  // payment slot the source printed must be accounted for, as a mapped rate, a
  // page-break repeat, or a row a person still has to resolve.
  const accounted = mappedRates + repeats + unresolvedSlots;
  const slotAccounting = {
    printed_slots: printedSlots,
    mapped_rate_rows: mappedRates,
    page_break_repeats: repeats,
    slots_in_unresolved_rows: unresolvedSlots,
    accounted,
    balanced: accounted === printedSlots
  };

  // The application's validator treats some problems as warnings so the app
  // can degrade gracefully — a reverts_to that names no tariff just makes the
  // ongoing cost unknown. That is right for the app and wrong for a proposed
  // update: a candidate that quietly makes eight tariffs' ongoing cost
  // unknown has lost information, and review is where that must surface. So
  // any warning the candidate has that the published dataset does not is a
  // gate. src/validate.js itself is unchanged.
  const warningKey = (w) => `${w.code}|${w.tariffId ?? ''}`;
  const publishedWarnings = new Set(published ? validateDataset(published).warnings.map(warningKey) : []);
  const introducedWarnings = validateDataset(candidate.dataset).warnings.filter((w) => !publishedWarnings.has(warningKey(w)));
  // Only a product that continues from the published dataset can have lost
  // information. A product new to the candidate is already listed as added
  // and reviewed as such, and an unknown ongoing cost on a new discounted
  // tariff is a normal property of the source, not a regression — gating on
  // it would block ordinary months. Its warnings are still reported.
  const degradedWarnings = introducedWarnings.filter((w) => w.tariffId && previous.has(w.tariffId) && current.has(w.tariffId));

  const gates = [
    ...candidate.review_required.map((item) => ({ kind: 'review_required', ...item })),
    ...degradedWarnings.map((w) => ({
      kind: 'validator_warning_introduced',
      reason: 'validator_warning_introduced',
      product_id: w.tariffId ?? null,
      validator_code: w.code,
      message: `The application's validator warns "${w.code}" for this continuing tariff in the candidate but not in the published dataset, so the candidate has lost information about it: ${w.message}`
    })),
    ...(slotAccounting.balanced
      ? []
      : [
          {
            kind: 'slot_accounting_unbalanced',
            message: `The source printed ${printedSlots} payment-method slots but ${accounted} are accounted for. A slot has been gained or lost in mapping; the candidate must not be published until the difference is explained.`,
            detail: slotAccounting
          }
        ])
  ];

  return {
    family: candidate.family,
    published_label: publishedLabel,
    source: {
      comparison_date: candidate.dataset.dataset.effective_from,
      statement: candidate.dataset.dataset.notes
    },
    slot_accounting: slotAccounting,
    dataset_fields: datasetFields,
    products: {
      added: added.map((t) => ({ id: t.id, supplier: t.supplier, name: t.name, status: t.status, methods: (t.rates ?? []).map((r) => r.payment_method) })),
      awaiting_decision: awaitingDecision.map((t) => ({ id: t.id, supplier: t.supplier, name: t.name, status: t.status, methods: (t.rates ?? []).map((r) => r.payment_method) })),
      removed: removed.map((t) => ({ id: t.id, supplier: t.supplier, name: t.name, status: t.status, methods: (t.rates ?? []).map((r) => r.payment_method) })),
      changed,
      wording_only: wordingOnly,
      unchanged_count: unchanged.length
    },
    suspected_renames: suspectRenames(removed, added),
    carry_forward: candidate.carry_forward_audit,
    decisions: {
      applied: candidate.decisions_applied ?? [],
      redundant: candidate.decisions_redundant ?? [],
      unmatched: candidate.decisions_unmatched ?? []
    },
    repeated_slots: candidate.repeated_slots ?? [],
    introduced_validator_warnings: introducedWarnings.map((w) => ({ ...w, gated: degradedWarnings.includes(w) })),
    gates,
    publishable: gates.length === 0,
    totals: candidate.totals
  };
}

// --- rendering --------------------------------------------------------------

const p = (value) => (value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value));

/** Renders a reconciliation as the markdown that goes in the candidate PR. */
export function renderReconciliation(report) {
  const out = [];
  const label = report.family === 'economy7' ? 'Economy 7' : 'Standard (24hr)';
  out.push(`# ${label} reconciliation — source dated ${report.source.comparison_date}`);
  out.push('');
  out.push(
    report.publishable
      ? '**No open gates.** Every payment slot the source printed is accounted for and no value needed a human decision. The candidate still requires human review before it is published.'
      : `**${report.gates.length} open gate${report.gates.length === 1 ? '' : 's'}.** The candidate is not publishable until each is resolved by a person.`
  );
  out.push('');

  const a = report.slot_accounting;
  out.push('## Source accounting');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Priced rows read | ${report.totals.source_rows} |`);
  out.push(`| Payment-method slots printed | ${a.printed_slots} |`);
  out.push(`| Rate rows mapped | ${a.mapped_rate_rows} |`);
  out.push(`| Page-break repeats (counted once) | ${a.page_break_repeats} |`);
  out.push(`| Slots in rows awaiting a decision | ${a.slots_in_unresolved_rows} |`);
  out.push(`| Balanced | ${a.balanced ? 'yes' : '**no**'} |`);
  out.push(`| Products (active / withdrawn) | ${report.totals.products} (${report.totals.active} / ${report.totals.withdrawn}) |`);
  out.push('');

  if (report.gates.length > 0) {
    out.push('## Gates');
    out.push('');
    for (const gate of report.gates) {
      const subject = gate.product_id ?? gate.detail?.cell ?? gate.kind;
      out.push(`- **${gate.reason ?? gate.kind}** — \`${subject}\``);
      if (gate.field) out.push(`  - field: \`${gate.field}\``);
      if (gate.page) out.push(`  - printed on page ${gate.page}, source row ${gate.source_row}`);
      if (gate.detail?.printed_name_lines?.length) out.push(`  - printed name lines: ${gate.detail.printed_name_lines.map((l) => `\`${l}\``).join(' / ')}`);
      if (gate.detail?.unaccounted_name_text) out.push(`  - name text not accounted for: \`${gate.detail.unaccounted_name_text}\``);
      if (gate.detail?.allocated?.length) out.push(`  - would have allocated: ${gate.detail.allocated.map((x) => `\`${x.id}\` (${x.methods.join(', ')})`).join('; ')}`);
      out.push(`  - ${gate.message}`);
    }
    out.push('');
  }

  if (report.dataset_fields.length > 0) {
    out.push('## Dataset-level changes');
    out.push('');
    for (const f of report.dataset_fields) out.push(`- \`${f.field}\`: ${p(f.from)} → ${p(f.to)}`);
    out.push('');
  }

  const { added, removed, awaiting_decision: awaiting = [], changed, wording_only: wordingOnly, unchanged_count } = report.products;
  out.push('## Products');
  out.push('');
  out.push(
    `${added.length} added, ${removed.length} no longer present, ${awaiting.length} printed but awaiting a decision, ${changed.length} materially changed, ` +
      `${wordingOnly.length} changed only in the transcribed source wording, ${unchanged_count} unchanged.`
  );
  out.push('');

  if (report.suspected_renames.length > 0) {
    out.push('### Suspected renames (not acted on)');
    out.push('');
    for (const r of report.suspected_renames) {
      out.push(`- \`${r.previous_id}\` "${r.previous_name}" → \`${r.candidate_id}\` "${r.candidate_name}"`);
      out.push(`  - ${r.basis}`);
    }
    out.push('');
  }

  if (awaiting.length > 0) {
    out.push('### Printed but awaiting a decision');
    out.push('');
    out.push('Still printed by the source, inside a row listed under **Gates**. Not withdrawn: absent from the candidate only until that row is resolved.');
    out.push('');
    for (const t of awaiting) out.push(`- \`${t.id}\` — ${t.supplier}, "${t.name}"`);
    out.push('');
  }

  for (const [heading, list] of [['Added', added], ['No longer present', removed]]) {
    if (list.length === 0) continue;
    out.push(`### ${heading}`);
    out.push('');
    for (const t of list) out.push(`- \`${t.id}\` — ${t.supplier}, "${t.name}" (${t.status}${t.methods.length ? `; ${t.methods.join(', ')}` : ''})`);
    out.push('');
  }

  if (changed.length > 0) {
    out.push('### Changed');
    out.push('');
    for (const c of changed) {
      out.push(`#### \`${c.id}\` — ${c.supplier}, "${c.name}"`);
      out.push('');
      for (const f of c.fields) out.push(`- \`${f.field}\`: ${p(f.from)} → ${p(f.to)}`);
      for (const m of c.rates.added) out.push(`- payment method added: \`${m}\``);
      for (const m of c.rates.removed) out.push(`- payment method no longer printed: \`${m}\``);
      for (const r of c.rates.repriced) out.push(`- \`${r.payment_method}\` \`${r.field}\`: ${p(r.from)} → ${p(r.to)}`);
      out.push('');
    }
  }

  if (wordingOnly.length > 0) {
    out.push('### Wording-only changes');
    out.push('');
    out.push(
      'These records differ only in `notes`, the transcribed ADDITIONAL INFORMATION column. No rate, term, credit or ' +
        'eligibility field changed. The extraction reproduces the printed wording; the published text had been punctuated by hand.'
    );
    out.push('');
    for (const c of wordingOnly) {
      out.push(`<details><summary><code>${c.id}</code> — ${c.supplier}, "${c.name}"</summary>`);
      out.push('');
      for (const f of c.fields) {
        out.push(`- published: ${p(f.from)}`);
        out.push(`- candidate: ${p(f.to)}`);
      }
      out.push('');
      out.push('</details>');
    }
    out.push('');
  }

  const { applied, redundant, unmatched } = report.decisions;
  if (applied.length + redundant.length + unmatched.length > 0) {
    out.push('## Recorded decisions');
    out.push('');
    out.push('Decisions a person has made about specific printed rows the source alone cannot resolve, from `scripts/extract/source-decisions.json`. Each applies only to the exact printed text it was made about.');
    out.push('');
    for (const d of applied) {
      out.push(`- **applied** \`${d.decision_id}\` → \`${d.product_id}\` (page ${d.page}, source row ${d.source_row})`);
      out.push(`  - published name: "${d.previous_name}"`);
      out.push(`  - printed name: "${d.printed_name}"`);
      out.push(`  - decided by ${d.decided_by}: ${d.reason}`);
    }
    for (const d of redundant) out.push(`- **no longer needed** \`${d.decision_id}\` — ${d.message}`);
    for (const d of unmatched) {
      out.push(`- **no longer matches the source** \`${d.decision_id}\` — ${d.supplier}, "${d.printed_tariff_name}" is not printed any more. It has not been applied to anything else.`);
    }
    out.push('');
  }

  if (report.carry_forward.length > 0) {
    out.push('## Carried-forward domain knowledge');
    out.push('');
    out.push('Values the source does not state, taken from the previous dataset only where the product identity is unchanged.');
    out.push('');
    out.push('| Product | Field | Value | From | Source contradicts |');
    out.push('|---|---|---|---|---|');
    for (const entry of report.carry_forward) {
      out.push(
        `| \`${entry.product_id}\` | \`${entry.field}\` | ${p(entry.value)} | \`${entry.previous_product_id}\` in ${entry.previous_dataset ?? '—'} | ${entry.source_contradicts ? '**yes**' : 'no'} |`
      );
    }
    out.push('');
  }

  if (report.repeated_slots.length > 0) {
    out.push('## Page-break repeats');
    out.push('');
    for (const r of report.repeated_slots) out.push(`- \`${r.product_id}\` \`${r.payment_method}\` reprinted on page ${r.printed_again_on_page}; counted once.`);
    out.push('');
  }

  return out.join('\n') + '\n';
}
