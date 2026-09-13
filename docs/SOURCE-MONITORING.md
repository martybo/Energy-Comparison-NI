# Consumer Council source monitoring

This is **phase 1** of automating tariff updates (issue #14): a scheduled
check that watches the Consumer Council's own landing pages for a new or
changed tariff-table PDF and surfaces that to a human. It does **not**
extract data, does **not** touch `data/` (the published tariff dataset the
calculator actually serves), and does **not** open or merge any change to
the tariff data itself. That is deliberately left to a future issue, which
can build on the discovery/provenance layer this establishes.

```
landing page → discover current PDF → download → hash → compare with last
known state → unchanged: stop quietly | changed: commit state + open an issue
```

Extraction, validation and an automated tariff-data PR are future work, not
part of this phase.

## Authoritative sources

Two tariff families are tracked independently, each from its own Consumer
Council landing page (never a hard-coded dated PDF filename):

| Tariff family | Landing page |
|---|---|
| Economy 7 | `consumers/.../switching-electricity-or-gas-supplier/economy-7` |
| Standard (24-hour) | `consumers/.../switching-electricity-or-gas-supplier/electricity-price-comparison-table` |

The full URLs are in `scripts/source-monitor/sources.mjs`, the single place
that names them.

## How the current PDF is discovered

`scripts/source-monitor/discover.mjs` fetches the landing page's HTML and:

1. Locates any heading that looks like the start of an archive/historical
   section (`Archive`, `Historical`, `Previous`, …) and discards everything
   from that point on, so an old dated PDF further down the page is never a
   candidate.
2. Extracts every remaining `<a href="...">.pdf` link.
3. Keeps only links whose text or URL matches the tariff family's expected
   wording (e.g. "Economy 7") and does not match an exclusion pattern (e.g.
   the standard-tariff page explicitly excludes anything mentioning
   "Economy 7", since both pages cross-link to each other).
4. Requires exactly one surviving candidate. Zero candidates, more than one
   equally plausible candidate, or a link that turns out not to actually be a
   PDF (checked by its `%PDF-` file signature, not just its URL or a
   `Content-Type` header) is a **hard failure**, not a guess.

This is a small tag-scanning parser, not a general HTML parser: the
repository has no build step or dependencies, and a Consumer Council page
that no longer fits the expected shape is exactly the kind of "unexpected
source structure" this is meant to fail loudly on, rather than silently
misinterpret.

## How a change is detected

For each family, the tool records:

- the tariff family and its landing page URL
- the discovered PDF URL and the link text it was found under
- a SHA-256 hash of the downloaded PDF's bytes (the immutable content
  identifier)
- size, `Last-Modified`/`ETag` if the server sent them, and the check
  timestamp

A source is **changed** if either the discovered PDF URL differs from the
last recorded one, or the content hash differs (same URL, different bytes).
Both can happen independently: the Council may publish a new dated file at a
new URL, or update the same URL in place — neither is treated as an error,
both are treated as "a human should look at this."

## Where source state lives, and why

Each family's last-known state is a small JSON file under
[`monitoring/source-state/`](../monitoring/source-state/), committed to the
repository — **not** a GitHub Actions cache and **not** stored only in a
workflow artefact. Two reasons:

- **Reliability across a monthly cadence.** Actions caches are evicted after
  about a week of no access; a schedule that only runs twice a month would
  routinely lose its "previous state" and re-report the same source as
  changed every run. A committed file has no such expiry.
- **Provenance.** Git history of these files *is* the change log of the
  Consumer Council sources over time, independent of the tariff-dataset
  history in `data/`.

The state files are written **only when something actually changed** — the
check timestamp on an unchanged source is never rewritten — so a scheduled
run that finds nothing new produces **no git diff and no commit**, exactly
as an unchanged source should. This is separate from the tariff-data
publishing process described in `docs/DATA.md`: these files never carry
tariff figures, are never read by the calculator, and updating them carries
none of the review weight a dataset change does.

## What happens on an unchanged run

Nothing changes in the repository. The workflow still runs to completion,
still uploads its (minimal) run artefact, and logs each family's status —
this is the expected steady state most runs should be in.

## What happens when a source changes

1. The new state is committed to `monitoring/source-state/<family>.json`
   directly (this is monitoring metadata, not tariff data — see above), so
   the next run compares against the new baseline and does not re-report the
   same change.
2. The workflow opens a GitHub issue summarising what changed (family,
   landing page, old/new PDF URL, new content hash, link text) for a human
   to review.
3. The downloaded PDF(s) and a run summary are uploaded as a workflow
   artefact (`source-monitor-run-<run id>`, 30-day retention) so a reviewer
   — or a future extraction step — can fetch the exact bytes that were
   hashed.

No tariff-data PR is created. A human decides whether and how to fold the
new source into `data/`, following the existing runbook in `docs/DATA.md`.

## How failures are surfaced

A landing page that cannot be fetched, a PDF that cannot be safely
identified, or a downloaded file that isn't actually a PDF each fail that
family's check with a specific error and a non-zero exit code; the workflow
run shows red and the failure is in the step log. One family failing does
not stop the other from being checked. The tool never falls back to an
archived document or invents a URL to make a run appear to succeed.

## Running it locally

```sh
node scripts/source-monitor/check-source.mjs            # both families
node scripts/source-monitor/check-source.mjs economy7   # one family
```

Downloaded PDFs and the run summary are written to `monitoring/downloads/`
(git-ignored). The workflow can also be run on demand from the Actions tab
via `workflow_dispatch`.

## Tests

`test/source-monitor.test.js` covers discovery (current PDF found; the
correct family selected off a page that links to another family's PDF;
missing/ambiguous/non-PDF candidates fail; an archived PDF is not selected
over a current one; malformed HTML fails safely) and change detection
(unchanged / URL-changed / content-changed / new, and that the two families
are tracked independently), all against local fixtures — never the live
Consumer Council site.

The fixtures in `test/fixtures/source-monitor/` are a best-effort
approximation of the real page structure, not a captured copy: this
environment's network policy did not allow fetching the live pages during
development (see the PR description for details). Re-running
`node scripts/source-monitor/check-source.mjs` from an environment with
access to consumercouncil.org.uk is the way to confirm the real pages fit
the assumptions here, and to correct `scripts/source-monitor/sources.mjs`'s
patterns if they don't.
