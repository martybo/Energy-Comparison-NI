# Extracting tariffs from the Consumer Council source

Phase 2 of tariff-update automation (issue #17). Phase 1, which watches the two
Consumer Council landing pages for a new or changed PDF, is in
[SOURCE-MONITORING.md](SOURCE-MONITORING.md).

A normal month should need no transcription. The pipeline reads the current
PDFs, derives a candidate dataset, reconciles it against the published one and
opens a pull request. **The review on that pull request is the gate**: nothing
is merged, published or deployed automatically.

## What it will not do

- modify `data/`, `src/` or `index.html`. The published datasets are read only
  to compare against, and to supply the two things the source never states.
- merge a pull request, or enable auto-merge on one.
- propose a tariff-data change from a run that only partly understood the
  source. See [Outcomes](#outcomes).
- relax `src/validate.js` to let an extraction through. A candidate the
  application's own validator rejects is an extraction failure, not a change.
- guess. Where the source is ambiguous the run stops and says what it could not
  resolve; see [Gates](#gates).

## The layers

Each stage has one job and fails rather than passing a half-understanding on.

| Layer | File | What it produces |
|---|---|---|
| 1. PDF text | `scripts/extract/pdf-text.mjs` | Positioned text runs: `{page, x, y, fontName, fontSize, text}`. Zero dependencies — the PDFs are FlateDecode streams of `/Type0` `/Identity-H` fonts, which Node's own `zlib` is enough for. |
| 2. Table | `scripts/extract/table.mjs` | Source rows, keyed to columns **by header text per page**, not by x-position. Notices (removals, scheduled changes) are collected separately. |
| 3. Mapping | `scripts/extract/map-canonical.mjs` | Canonical tariff records, per-field provenance, the carry-forward audit, and the review items. |
| 4. Reconciliation | `scripts/extract/reconcile.mjs` | The human-readable diff against the published dataset, and the slot accounting that makes it trustworthy. |
| 5. Outcome | `scripts/extract/outcomes.mjs` | What the run concluded and what the automation may therefore do. |
| Driver | `scripts/extract/run-pipeline.mjs` | Runs all of it and writes a candidate directory. |

### Why there is no PDF library

`package-lock.json` is gitignored, so a runtime npm dependency would not be
reproducible in CI: a month's extraction could change because a transitive
dependency did. Reading the source's own narrow PDF shape with `zlib` is a few
hundred lines, and it refuses anything it does not understand — a font that is
not `/Type0` `/Identity-H`, a non-identity `/ToUnicode` CMap, a page with no
text — rather than decoding it into plausible nonsense.

## Running it

```sh
# From the committed text-item fixtures. Reproducible, offline, no PDFs needed.
node scripts/extract/run-pipeline.mjs --out candidate

# From the live site, discovering each current PDF as the monitor does.
node scripts/extract/run-pipeline.mjs --out candidate --live

# From a PDF already on disk.
node scripts/extract/run-pipeline.mjs --out candidate --pdf standard=/tmp/standard.pdf
```

The candidate directory always contains `outcome.json`, `summary.md`, and a
reconciliation, provenance record and source-row trace per table. It contains a
`data/` subdirectory **only** when a table was read cleanly and genuinely
changed, and that subdirectory's existence is the automation's entire
permission to propose a change to published tariffs.

## Outcomes

A run classifies each table, then itself. Only a clean change may produce a
dataset.

| Outcome | Meaning | Candidate PR | Tariff data proposed | Workflow |
|---|---|---|---|---|
| `changed` | Read cleanly; the canonical data genuinely moved. | yes | yes | passes |
| `unchanged` | Read cleanly; nothing material moved. | no | no | passes |
| `blocked` | Read, but something could not be resolved without a person. | yes, review-only | **no** | passes |
| `extraction_failed` | The document is not the one this extractor understands, or the candidate fails `src/validate.js`. | no | no | **fails** |
| `source_unavailable` | The PDF could not be discovered or downloaded. | no | no | **fails** |

A run is as weak as its weakest table. The two tables are separate documents,
so one being `blocked` does not invalidate the other's clean reading and a
clean table still proposes its own update. A run that failed to *read or reach*
a document is different in kind — the automation's picture of the source is
incomplete — so it withdraws any data update the other table had proposed, and
fails.

`blocked` deliberately does not fail the workflow. It has produced something a
person should look at, and a red run with no pull request would bury it.

### Why a republished source with the same prices is `unchanged`

The Council regenerates its PDFs on request, and reprints them on new dates
without changing a price. Rewriting the dataset so it records a new date, plus
every record's transcribed wording, would be churn in exchange for nothing — so
it is not done. The monitor already records that the source changed; the
reconciliation says the prices did not.

One consequence worth knowing: when a price does eventually move, that month's
candidate also carries the accumulated wording differences. The reconciliation
separates them under **Wording-only changes** so they do not bury the real
change.

## What is derived and what is carried forward

Two tiers, and the boundary is not a matter of taste.

**Tier 1 — source-derived.** Everything the PDF states: supplier, name, meter
type, rates per payment method, headline discount, contract type, term and exit
fee, eligibility, introductory period and its basis, credits, status, the
source's own wording, provenance. Reproducible from the current document alone.

The source states these in either printed column. `1 Year Home Electricity 15%
discount` carries the term in the tariff's **name** while the information column
says only `Fixed term`; the `£30 welcome credit` is likewise often in the name.
Both columns are read. That is still the source stating it.

**Tier 2 — persistent domain knowledge the PDF does not contain.** Three
things, and only these:

- `reverts_to` — the source never says what a fixed-term tariff reverts to.
- `discount_cap` structure — Power NI's rows state `Maximum of £60 savings per
  year` but not the £250-per-quarter / £1,000-per-year threshold the calculator
  models.
- product grouping — where one printed row covers several named products.

Tier 2 is carried forward from the previous dataset, and **only** for a product
whose identity is demonstrably unchanged: the same canonical id, supplier and
name. It is never inferred for a new product from a similar name, the same
supplier, matching rates or anything else. A new SSE fixed-term tariff does not
acquire a `reverts_to` because eight others have one.

Every carried value is tagged `carried_forward` in `field_provenance` and gets a
machine-readable audit entry naming the previous dataset, the previous product,
the field, why it was eligible, and whether the current source contradicts it.
A field needing a value nobody can supply is tagged `needs_review`.

Three things are never resolved silently:

- **the source contradicts a carried value** — the cap is dropped and raised,
  not retained;
- **a carried value the previous dataset held is no longer signalled** — the old
  value is not kept on an unverified basis, and its absence is not read as the
  source withdrawing it;
- **money stated beside the word "credit" that no pattern can place** — raised,
  because a missed credit understates what the customer receives.

### Why the previous dataset is not the authority

The direction of derivation is *PDF → source rows → canonical products → domain
knowledge*, not *last month's JSON with new prices*. The previous dataset is a
golden comparison and the source of the two things above; it is not the
specification. Where the candidate and the published dataset disagree, the
question is which reading the source supports — the PDF may have changed, the
earlier transcription may have been wrong, or the mapping may have
misunderstood. The 46th Standard payment slot below is a case where the
published dataset was the one at fault.

## Gates

A gate means the run read the source but cannot responsibly turn part of it into
data. The candidate carries the reconciliation and provenance and **no dataset**,
so there is nothing to merge while the question stands.

Gates are raised for:

- a printed row whose names or payment methods cannot all be accounted for
  (`ambiguous_product_grouping`);
- a product that needs domain knowledge the source does not state and that
  cannot be carried forward (`tier2_missing_for_new_product`,
  `tier2_missing_for_existing_product`);
- a carried value the source contradicts, or one the previous dataset held that
  the source no longer signals (`carried_value_contradicted_by_source`,
  `carried_value_lost`);
- money stated beside "credit" that no pattern can place
  (`unplaced_credit_amount`);
- one product and payment method printed twice at different prices
  (`conflicting_rate_for_payment_method`);
- a recorded decision that cannot be applied (`decision_not_applicable`);
- a **continuing** product for which the application's validator now warns but
  did not warn on the published dataset (`validator_warning_introduced`) — see
  below;
- slot accounting that does not balance.

### The current Standard gate

**One printed row, three tariff names, two payment methods.** Page 8 prints one
price (40.790p) against bulleted lists: `SmartSaver Std 24hr`, `Keypad Standard
Rate 24hr`, `Standard Rate 24hr`; and `Pay on receipt of bill`, `Prepayment
meter`. Nothing pairs them, and the bullet order does not either — the
30/09/2026 table reorders the three names while leaving the two methods as they
were. Every allocation that balances the methods drops a name. Refused, pending
a recorded decision. Eight SSE fixed-term tariffs revert to `Standard Rate
24hr`, so this row also raises `validator_warning_introduced` for each of them.

### Validator warnings as gates

`src/validate.js` deliberately treats some problems as *warnings*, so the app
can degrade gracefully — a `reverts_to` naming no tariff just makes that
tariff's ongoing cost unknown. That is right for the app and wrong for a
proposed update: a candidate that quietly makes a published tariff's ongoing
cost unknown has lost information. So a warning on a **continuing** product
(in both the published dataset and the candidate) that the published dataset
did not have is a gate. Warnings on a product new to the candidate are reported
but do not gate: an unknown ongoing cost on a new discounted tariff is a normal
property of the source, and gating on it would block ordinary months.
`src/validate.js` itself is unchanged.

Separately, a candidate the validator *rejects* — any `rejected` record or any
dataset-level `errors` — is an `extraction_failed`, not a change.

### Printed but awaiting a decision

A published product missing from the candidate is not necessarily gone. If the
source still prints it inside a gated row, the reconciliation lists it under
**Printed but awaiting a decision**, not **No longer present**, so a reviewer
does not read an unresolved row as a withdrawal the Council never made.

### Slot accounting

The integrity check the rest of the reconciliation rests on: every
payment-method slot the source prints must be accounted for, as a mapped rate, a
page-break repeat, or a slot inside a row awaiting a decision. An imbalance is
itself a gate. Two source quirks it handles explicitly:

- a row straddling a page break reprints its name, method and price; counted
  once, recorded. The same method at a *different* price is a gate, not
  first-row-wins.
- Share Energy writes the payment method into the tariff-name column
  (`Share Eco 7- Pay on receipt of bill or e- bill`). That is one product priced
  per method. Anything in a name cell that is neither a product name nor
  payment wording is a gate.

## Recorded decisions

Where the source genuinely cannot be resolved from the document alone, a person
decides, and the decision is recorded in
[`scripts/extract/source-decisions.json`](../scripts/extract/source-decisions.json).
The pipeline applies recorded decisions; it never makes one.

Each decision is **source-specific, not a general rule**:

- it is anchored to the exact printed row it was made about — supplier, tariff
  name as printed, and the set of payment methods printed, plus the printed
  rates when the decision depends on them;
- if the Council changes that row, the decision simply stops matching, the row
  is not understood again, and the run blocks for a fresh decision rather than
  carrying an old one onto a new situation;
- it records what was decided, by whom, why, and the evidence.

The mapper refuses a malformed decision (an unknown kind, a missing reason,
missing evidence, two decisions matching one row) as an `extraction_failed`,
rather than skipping it: a typo must not quietly switch a decision off.

The reconciliation lists every decision under **Recorded decisions**: those
applied, those no longer needed because the published dataset now matches the
source (remove these), and those that no longer match anything because the
source changed.

### Kinds

**`identity`** — a printed tariff name is the same product as one in the
previous dataset, which recorded its name differently. The product keeps its
id; its name becomes exactly what the source prints (the decision may not
rename it to anything else). Its identity is tagged `human_decision` in field
provenance, and any Tier 2 value carried across it names the decision as the
basis in the carry-forward audit. An identity decision is anchored on the
printed name and payment methods, not the price: it is about what a name
refers to, and a new month's price must not demand it be decided again.

Current decisions:

- `standard-sse-1-year-home-keypad-10-5-identity` — the Standard table prints
  `1 Year Home Keypad 10.5% discount plus £30 welcome credit (24hr)`; the
  published dataset recorded it without "Home". The published dataset was
  transcribed from the 12/09/2026 table, and its own source-row trace places
  this product on page 6 as the third SSE row, one prepayment slot — the row
  that prints "Home". Printed identically in the 12/09, 14/09 and 30/09 tables.
  A transcription correction: id kept, name corrected.

## Source quirks this depends on

Found by running against the real documents, and each handled where it belongs
rather than by fitting the extractor to the existing dataset.

| Quirk | Handling |
|---|---|
| The print endpoint regenerates the PDF per request, so raw bytes differ every download. | The monitor hashes a masked copy (`/CreationDate`, `/ModDate`, trailer `/ID` removed). Fixture `pdf_sha256` is the hash of that one capture, not a stable identifier. |
| `&amp;` reaches the PDF undecoded in one Budget Energy name. | Decoded. An **unrecognised** entity is refused rather than passed into a name or an id. |
| A styled HTML span becomes its own positioned run, so one sentence arrives in pieces and rejoins with spaces before punctuation. | Repaired only where a space cannot be intentional. Missing sentence punctuation is left as printed — the published text had been tidied by hand, and the extraction reproduces the source. |
| The tariff-name column may list several products sharing one price. | Grouping is carried forward where the previous dataset records it; otherwise a gate. |
| A removal notice names withdrawn tariffs. | Changes availability and nothing else: the tariff keeps its previously recorded terms and its published id. |
| The Council prints the already-discounted rate. | A percentage discount is never added as an adjustment — doing so would double-count it. |
| A credit may be stated as instalments (`£80 free credit (£40 after switchover and £40 after month 9)`). | Counted once at its stated total; the schema's credit types are one-off by definition, and the breakdown stays in the transcribed notes. |

## Fixtures

`test/fixtures/consumer-council/*-text-items.json` are the positioned text
layers captured from the real PDFs, with provenance. The PDFs themselves are not
committed: they are a third-party publication, and this repository's convention
is to carry derived, auditable data. The captured text layer is derived data of
exactly that kind, and it makes the table, mapping and reconciliation tests
deterministic and offline while still testing the real document structure.

Regenerate one when the Council's layout changes, so the tests keep describing
the real source rather than a remembered one:

```sh
node scripts/extract/dump-text-items.mjs standard /tmp/standard.pdf
```

## The workflow

`.github/workflows/tariff-extraction.yml`, scheduled on the 2nd and 16th — the
day after the monitor's own checks, so a change it has already recorded is
extracted on the next run rather than racing it. `workflow_dispatch` takes a
`use_fixtures` input for exercising the workflow itself without touching the
live site.

It runs the test suite, runs the pipeline, uploads the candidate directory as an
artefact on every run including a failed one, then does only what
`outcome.json` permits. It adds no policy of its own: it copies
`candidate/data/` if it exists, and the pipeline decides whether it exists.

A scheduled run happens twice a month, so an open candidate for the same
outcome is updated in place and commented on rather than opened again.

### Commissioning

As with the monitor, the first live `workflow_dispatch` is the real test — the
offline pipeline cannot prove discovery, download or the WAF's behaviour. Run it
once by hand, check `outcome.json` and the reconciliation against the PDFs
yourself, and do not rely on it unattended until that has passed.
