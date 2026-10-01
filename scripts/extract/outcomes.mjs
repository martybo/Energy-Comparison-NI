/**
 * What a monthly run concluded, and what the automation is therefore allowed
 * to do.
 *
 * The distinction this module exists to enforce: a run that only partly
 * understood the source must never produce something that looks like a normal
 * tariff update. "Extraction succeeded" and "the result is publishable" are
 * different claims, and a candidate PR carries a data update only when both
 * hold.
 */

export const OUTCOMES = {
  /** Read cleanly, and the canonical data genuinely changed. */
  CHANGED: 'changed',
  /** Read cleanly, and nothing material changed. The source may still have
   *  been republished on a new date; rewriting the dataset to say the same
   *  prices is churn, so it is not done. */
  UNCHANGED: 'unchanged',
  /** Read, but something in it could not be resolved without a person. */
  BLOCKED: 'blocked',
  /** The document's layout, fonts or table structure were not what the
   *  extractor understands, so no reading was obtained. */
  EXTRACTION_FAILED: 'extraction_failed',
  /** The PDF could not be discovered or downloaded at all. */
  SOURCE_UNAVAILABLE: 'source_unavailable'
};

/**
 * The policy for each outcome. `data_update` is the one that matters: it is
 * false for every outcome except a clean change, so no partially understood
 * month can reach `data/`.
 */
export const OUTCOME_POLICY = {
  [OUTCOMES.CHANGED]: {
    candidate_pr: true,
    data_update: true,
    workflow_fails: false,
    summary: 'Create a candidate PR containing the new dated dataset and the pointer that publishes it. Merging is a human decision; nothing is merged or deployed automatically.'
  },
  [OUTCOMES.UNCHANGED]: {
    candidate_pr: false,
    data_update: false,
    workflow_fails: false,
    summary: 'No PR. The canonical data is already correct, and rewriting it to record a new source date would be churn.'
  },
  [OUTCOMES.BLOCKED]: {
    candidate_pr: true,
    data_update: false,
    workflow_fails: false,
    summary: 'Create a review-only PR carrying the reconciliation and provenance. It contains no dataset file and no pointer change, so there is nothing a reviewer could merge into production data while the ambiguity stands.'
  },
  [OUTCOMES.EXTRACTION_FAILED]: {
    candidate_pr: false,
    data_update: false,
    workflow_fails: true,
    summary: 'Fail the workflow. The source document is not the one this extractor understands; a person must look at it before anything is derived from it.'
  },
  [OUTCOMES.SOURCE_UNAVAILABLE]: {
    candidate_pr: false,
    data_update: false,
    workflow_fails: true,
    summary: 'Fail the workflow. Nothing was read, so nothing is concluded about the tariffs.'
  }
};

/** Worst first: a run is as weak as its weakest family. */
const SEVERITY = [
  OUTCOMES.SOURCE_UNAVAILABLE,
  OUTCOMES.EXTRACTION_FAILED,
  OUTCOMES.BLOCKED,
  OUTCOMES.CHANGED,
  OUTCOMES.UNCHANGED
];

/**
 * Classifies one family from its reconciliation.
 *
 * A gate of any kind blocks. Otherwise a change to a product — added, removed,
 * or a material field including a rate or payment method — makes the run a
 * change. Records differing only in the transcribed source wording do not, on
 * their own, justify rewriting the dataset: the published text says the same
 * thing, and the difference recurs every month.
 */
export function classifyFamily(report) {
  if (report.gates.length > 0) {
    return {
      family: report.family,
      outcome: OUTCOMES.BLOCKED,
      reason: `${report.gates.length} unresolved question${report.gates.length === 1 ? '' : 's'} about the source: ${[...new Set(report.gates.map((g) => g.reason ?? g.kind))].join(', ')}.`,
      gates: report.gates.length,
      material_changes: report.products.added.length + report.products.removed.length + report.products.changed.length
    };
  }

  const material = report.products.added.length + report.products.removed.length + report.products.changed.length;
  if (material > 0) {
    return {
      family: report.family,
      outcome: OUTCOMES.CHANGED,
      reason: `${report.products.added.length} product(s) added, ${report.products.removed.length} no longer present, ${report.products.changed.length} materially changed.`,
      gates: 0,
      material_changes: material
    };
  }

  return {
    family: report.family,
    outcome: OUTCOMES.UNCHANGED,
    reason:
      report.products.wording_only.length > 0 || report.dataset_fields.length > 0
        ? `The source was republished (${report.dataset_fields.map((f) => f.field).join(', ') || 'no dataset fields changed'}) but no rate, term, credit, eligibility or payment method moved. ${report.products.wording_only.length} record(s) differ only in the transcribed source wording.`
        : 'Nothing in the source differs from the published dataset.',
    gates: 0,
    material_changes: 0
  };
}

/** A family that never got as far as a reconciliation. */
export function failedFamily(familyId, outcome, error) {
  return {
    family: familyId,
    outcome,
    reason: error?.code ? `${error.code}: ${error.message}` : String(error?.message ?? error),
    gates: 0,
    material_changes: 0
  };
}

/**
 * The run's own outcome, and what the automation may do about it.
 *
 * The two tables' families are separate documents, so one being blocked does
 * not invalidate the other's clean reading: a data update is written per
 * family, for the families that are themselves clean changes. A run that
 * failed to read or reach a document is different in kind — it means the
 * automation's picture of the source is incomplete — so it writes no data
 * update at all and fails, however clean the other family looked.
 */
export function classifyRun(families) {
  const outcome = SEVERITY.find((candidate) => families.some((f) => f.outcome === candidate)) ?? OUTCOMES.UNCHANGED;
  const policy = OUTCOME_POLICY[outcome];
  const hardFailure = outcome === OUTCOMES.SOURCE_UNAVAILABLE || outcome === OUTCOMES.EXTRACTION_FAILED;
  return {
    outcome,
    policy,
    families,
    data_update_families: hardFailure ? [] : families.filter((f) => f.outcome === OUTCOMES.CHANGED).map((f) => f.family),
    review_only_families: hardFailure ? [] : families.filter((f) => f.outcome === OUTCOMES.BLOCKED).map((f) => f.family),
    workflow_fails: policy.workflow_fails,
    // The headline a person reads first. It never says "updated" for a run
    // that only partly understood the source.
    headline: headlineFor(outcome, families)
  };
}

function headlineFor(outcome, families) {
  const per = families.map((f) => `${f.family}: ${f.outcome}`).join(', ');
  switch (outcome) {
    case OUTCOMES.SOURCE_UNAVAILABLE:
      return `Source unavailable — nothing was read, and no tariff data is proposed (${per}).`;
    case OUTCOMES.EXTRACTION_FAILED:
      return `Extraction failed — the source is not the document this extractor understands, and no tariff data is proposed (${per}).`;
    case OUTCOMES.BLOCKED:
      return `Blocked on an unresolved question about the source. A review-only candidate is available; no tariff data is proposed for the blocked table (${per}).`;
    case OUTCOMES.CHANGED:
      return `Candidate tariff data change ready for review (${per}).`;
    default:
      return `No canonical change (${per}).`;
  }
}
