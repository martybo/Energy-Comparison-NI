import { existsSync } from 'node:fs';

/**
 * The names a new dataset and its documents are published under. Normally
 * the source's own date; but a correction to a snapshot that is already
 * published — the same stated date — must never overwrite the published
 * files, so it takes the first free revision suffix instead (-r2, -r3, …).
 */
export function publicationNames(config, date, exists = existsSync) {
  for (let revision = 1; revision < 100; revision += 1) {
    const suffix = revision === 1 ? date : `${date}-r${revision}`;
    const names = {
      suffix,
      dataset: `data/${config.stem}-${suffix}.json`,
      reconciliation: `docs/RECONCILIATION-${config.docsPrefix}${suffix}.md`,
      sourceRows: `docs/source-rows-${config.docsPrefix}${suffix}.json`,
      // The provenance record — field provenance, carry-forward audit,
      // recorded decisions and any source discrepancies they note — is
      // published beside the dataset it explains, so it stays with the data
      // rather than surviving only in a closed pull request's history.
      provenance: `docs/PROVENANCE-${config.docsPrefix}${suffix}.json`
    };
    if (![names.dataset, names.reconciliation, names.sourceRows, names.provenance].some((path) => exists(path))) return names;
  }
  throw new Error(`No free publication name for ${config.stem} ${date}`);
}
