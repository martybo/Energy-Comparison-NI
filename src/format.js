/**
 * Display formatting. The only place rounding happens.
 *
 * A Year 1 total and its monthly average are each rounded from full precision,
 * so monthly x 12 will not generally equal the Year 1 figure. That is correct
 * and must not be reconciled by adjusting either number.
 */

export function gbp(value, { signed = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : signed ? '+' : '';
  return `${sign}£${Math.abs(value).toFixed(2)}`;
}

export function pence(value, dp = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(dp)}p`;
}

/** "£658.59 estimated Year 1" / "£54.88/month average in Year 1" */
export function year1Headline(result) {
  return `${gbp(result.year1.total)} estimated Year 1`;
}

export function year1Monthly(result) {
  return `${gbp(result.year1.averageMonthly)}/month average in Year 1`;
}

/** Never claims an ongoing figure that is not known (R1). */
export function ongoingHeadline(result) {
  if (!result.ongoingKnown) return 'Ongoing cost not known';
  return `${gbp(result.ongoing.total)}/year ongoing`;
}

export function ongoingMonthly(result) {
  if (!result.ongoingKnown) return null;
  return `${gbp(result.ongoing.averageMonthly)}/month ongoing`;
}

/** "Includes £130 welcome credit" — shown separately so ranking is explicable. */
export function creditSummary(result) {
  const oneOff = result.credits.filter((c) => !c.spreadable);
  const recurring = result.credits.filter((c) => c.spreadable);
  const parts = [];
  for (const c of oneOff) {
    const when =
      c.month != null
        ? ` (applied in month ${c.month})`
        : ' (timing not stated by the supplier)';
    parts.push(`Includes ${gbp(c.amountGbp)} welcome credit${when}`);
  }
  for (const c of recurring) {
    parts.push(`Includes ${gbp(c.amountGbp)} credit per ${c.frequency === 'annual' ? 'year' : 'month'}`);
  }
  return parts;
}

/** Contract and eligibility disclosure. Exit fee is a risk, not a cost (R3). */
export function conditionSummary(result) {
  const c = result.conditions;
  const parts = [];
  if (c.newCustomersOnly === true) parts.push('New customers only');
  if (c.contractType === 'fixed' && c.termMonths) parts.push(`${c.termMonths}-month fixed term`);
  if (c.contractType === 'unknown') parts.push('Contract terms not verified');
  if (typeof c.exitFeeGbp === 'number' && c.exitFeeGbp > 0) parts.push(`${gbp(c.exitFeeGbp)} exit fee if you leave early`);
  if (c.exitFeeGbp === 0) parts.push('No exit fee');
  if (result.introPeriodKnown && result.introPeriodMonths > 0) parts.push(`Introductory rate for ${result.introPeriodMonths} months`);
  if (!result.introPeriodKnown && result.headlineDiscountPct != null) parts.push('Discount duration not stated by the supplier');
  return parts.concat(c.notes);
}

export function datasetAgeDays(meta, now = new Date()) {
  if (!meta || !meta.effective_from) return null;
  const from = new Date(meta.effective_from + 'T00:00:00Z');
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((now.getTime() - from.getTime()) / 86400000);
}

/** Stale data must announce itself rather than pass as current (B3). */
export function datasetStatus(meta, now = new Date()) {
  const age = datasetAgeDays(meta, now);
  if (age === null) return { level: 'error', message: 'Tariff data has no effective date and cannot be trusted.' };
  if (age > 60) {
    return {
      level: 'error',
      age,
      message: `These rates are from ${meta.effective_from} and are about ${Math.round(age / 30)} months out of date. They are shown to demonstrate the comparison only and must not be used to choose a tariff.`
    };
  }
  if (age > 35) {
    return { level: 'warn', age, message: `These rates are from ${meta.effective_from} and may have changed.` };
  }
  return { level: 'ok', age, message: `Rates effective from ${meta.effective_from}.` };
}
