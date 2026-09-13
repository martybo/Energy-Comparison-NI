# Native iOS app: architecture and product exploration

**Status: exploration / design proposal. Nothing here is built, and this
document authorises nothing.** It exists to make the decision about whether —
and how — to build a native iOS app a reviewable one. No application code, no
Swift, no tariff data and no calculation behaviour is included or changed by
the pull request carrying this file.

Issue [#18](https://github.com/martybo/Energy-Comparison-NI/issues/18).

Where a claim rests on a current Apple platform capability it is cited against
Apple's own developer documentation in [References](#references), and the text
says so. Where a recommendation rests on judgement rather than evidence, it says
that too. Several recommendations here are **reasoned, not proven**, and
[§18](#18-risks-and-unresolved-decisions) lists what would have to be prototyped
before committing to them.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [Product boundary](#2-product-boundary)
3. [User journeys](#3-user-journeys)
4. [Meter-reading data model](#4-meter-reading-data-model)
5. [Contracted-tariff data model](#5-contracted-tariff-data-model)
6. [Personalised comparison model](#6-personalised-comparison-model)
7. [CSV import/export proposal](#7-csv-importexport-proposal)
8. [Local storage proposal](#8-local-storage-proposal)
9. [iCloud/CloudKit assessment](#9-icloudcloudkit-assessment)
10. [Notification architecture](#10-notification-architecture)
11. [Shared web/iOS calculation strategy](#11-shared-webios-calculation-strategy)
12. [Tariff-data delivery strategy](#12-tariff-data-delivery-strategy)
13. [Versioning and provenance](#13-versioning-and-provenance)
14. [Privacy and security](#14-privacy-and-security)
15. [Architecture options comparison](#15-architecture-options-comparison)
16. [Recommended architecture](#16-recommended-architecture)
17. [Recommended staged MVP](#17-recommended-staged-mvp)
18. [Risks and unresolved decisions](#18-risks-and-unresolved-decisions)
19. [Explicitly deferred features](#19-explicitly-deferred-features)
- [References](#references)

---

## 0. What the existing project already establishes

This exploration treats the current web application as the **reference
implementation**, not as a prototype to be replaced. Reading it produced four
findings that shape almost every recommendation below.

**The calculation engine already has the right seam.** `src/calc.js` prices a
tariff against a single canonical usage shape — `{ annualDayKwh, annualNightKwh }`
— and `usageFromAnnualSplit`, `usageFromDaily` and `usageFromAnnualDayNight` are
all just different ways of producing that pair. A personal meter-reading ledger
is therefore *not* a new calculator. It is a fourth way of producing the same two
numbers. Everything downstream — ranking, Year 1/ongoing semantics, payment-method
ties, discount caps, credit timing — is reached unchanged. This is the single most
important structural fact in this document.

**A tariff record is a plain data shape, and the engine has no
supplier-specific branching.** `costFor(tariff, rateRow, usage, context)` will
price *any* object of the documented shape. The user's own contracted tariff can
therefore be expressed in that same shape and priced by the identical code path,
with no second "what my bill costs" calculator to keep in step. See
[§5](#5-contracted-tariff-data-model).

**The engine already reports its own uncertainty as structured data.**
`ongoingKnown`, `year1.complete`, `introPeriodKnown`, `creditExceedsCost`,
`paymentMethodTie`, `discountCap`, and a `warnings` array with stable `code`
values. An iOS app does not need to invent a confidence model; it needs to stop
swallowing the one that exists. This is what makes a *defensible* notification
threshold possible ([§10](#10-notification-architecture)).

**Provenance is already first-class.** The dataset header carries
`schema_version`, `effective_from`, `published`, `source`, `source_url`,
`source_pdf_url`, `vat_treatment`, `conditions_verified` and a plain-language
`conditions_verified_meaning`; `docs/RECONCILIATION-*.md` and
`docs/source-rows-*.json` trace every figure to a source row; and
`monitoring/source-state/` records the Consumer Council source each dataset came
from. The iOS app's job is to *surface* this, not to build a parallel provenance
story.

Two constraints follow from the repository's own conventions and are treated as
binding throughout:

- **The iOS app never fetches or parses Consumer Council material.** Source
  discovery, change detection (issues #14/#15/#16) and future PDF extraction
  (#17) stay in the version-controlled pipeline. The app consumes the pipeline's
  *output* only.
- **`null` means unknown; `0`/`false` mean known-to-be-none.** This distinction
  is enforced by `src/validate.js` and must be carried into every Swift type. A
  Swift `Double` defaulting to `0` where the dataset says `null` would silently
  reintroduce exactly the class of error `intro_period_basis` was added to make
  impossible.

---

## 1. Executive summary

**Recommendation: build it, as Option B — a local-first native app with optional
iCloud sync added late — and use *local* notifications, not push. No backend is
required, now or for the notification feature.**

The eight headline conclusions:

1. **The product boundary is coherent**, but not in the way the framing
   suggests. The web app answers *"what is cheapest?"*. The app answers
   *"is my actual deal still good enough to leave alone?"*. Those are different
   questions with different data requirements, and the second one is the only
   thing that justifies an app at all ([§2](#2-product-boundary)).

2. **The notification requirement does not need a server.** Apple's documented
   background-refresh mechanism (`BGAppRefreshTask`) can fetch the versioned
   tariff JSON that is *already* published by GitHub Pages, run the comparison
   on-device, and raise a **local** notification. Remote push would require a
   provider server, device tokens and an APNs connection — a permanent
   operational burden for a latency improvement nobody needs on a dataset that
   changes roughly monthly ([§10](#10-notification-architecture)).

3. **Calculation drift is the biggest long-term risk, and the answer is
   generated conformance vectors, not shared code.** Treat `src/calc.js` as
   normative, generate a version-controlled JSON test-vector file from the
   existing fixtures, and make CI fail when the vectors and the engine disagree.
   A Swift port then has an executable definition of "correct" and drift becomes
   a reviewed event rather than a silent one ([§11](#11-shared-webios-calculation-strategy)).

4. **The contracted tariff must be a value snapshot, never a live reference**
   to a public tariff id. Copy the rates in at the moment of recording; keep the
   source id as provenance only. This makes "the dataset update changed my
   contract" structurally impossible rather than merely avoided
   ([§5](#5-contracted-tariff-data-model)).

5. **CSV import is far more valuable, far earlier, than the suggested phase
   order implies.** A meter-reading ledger has roughly a twelve-month value
   latency — it tells the user nothing useful until a year has passed. Import is
   the only thing that collapses that latency for a user who already keeps a
   spreadsheet. It should ship *with* the ledger, not two phases later
   ([§17](#17-recommended-staged-mvp)).

6. **Adopt CloudKit's schema constraints from day one, even if CloudKit is
   never switched on.** Apple documents that CloudKit schemas are *additive
   only* — after promotion to production you cannot delete model types or change
   existing attributes — and that unique constraints and non-optional
   relationships are unsupported. Designing around those rules costs almost
   nothing now and is expensive to retrofit
   ([§8](#8-local-storage-proposal), [§9](#9-icloudcloudkit-assessment)).

7. **Model the standard single-rate meter now; build only the Economy 7 UI
   now.** The web engine already prices both families. Leaving the meter type out
   of the persisted model would force a schema migration precisely where
   migrations are hardest ([§4](#4-meter-reading-data-model)).

8. **Ship CSV export before iCloud sync.** The genuine risk to a user with two
   years of hand-entered readings is data loss, and export solves that at a
   fraction of CloudKit's complexity and irreversibility. Sync is a
   *convenience*; backup is a *requirement*, and they are not the same feature
   ([§9](#9-icloudcloudkit-assessment)).

**What this does not settle.** Whether iOS grants this specific app enough
background runtime to make notifications feel timely is an empirical question
that only a prototype answers ([§18.1](#181-background-refresh-cadence--highest-prototype-priority)).
So is whether SwiftData + CloudKit is dependable enough at this scale. Both are
reasoned about below; neither is proven.

---

## 2. Product boundary

### 2.1 The proposed split

| | **Web** | **iOS** |
|---|---|---|
| Question answered | "What is cheapest right now?" | "Is my actual deal still good enough?" |
| Usage input | Estimated, or typed from a bill | Estimated, typed, **or derived from the user's own meter history** |
| Baseline for comparison | The cheapest published tariff | **The user's actual contracted rates** |
| Persistence | None | Meter ledger, contract history, opportunity history |
| Account | None | **None** |
| Return visit | User remembers to check | App checks and tells them |
| Data leaving the device | None | **None** (optionally the user's own iCloud) |

Everything on the web side stays on the iOS side. The app is a superset, not a
fork.

### 2.2 Is this a coherent boundary? Yes — but the reason matters

A reasonable challenge is: *why not add local storage to the web app and have
users install it to the home screen?* That deserves a straight answer, because if
a home-screen web app can do this, a native app is unjustified effort.

It cannot, for one specific reason. The differentiating feature is
**"tell me when something changes, without me having to remember to look."**
That needs the app to do work while the user is not using it. Apple's developer
documentation describes background execution for web content on iOS through no
equivalent of the Background Tasks framework, and third-party surveys through
2026 consistently report that the Background Sync, Periodic Background Sync and
Background Fetch APIs remain unimplemented in Safari on iOS with no announced
timeline (these are secondary sources; the absence of a corresponding Apple API
reference is the stronger signal). Web Push to a home-screen web app has existed
since iOS 16.4, but *push implies a server* — which is precisely the dependency
this project should avoid ([§10.2](#102-why-push-is-the-wrong-answer-here)).

So the boundary is not "native is nicer". It is:

> **The app exists because periodic unattended local computation is a native-only
> capability, and that capability is the entire product.**

Three secondary native advantages follow, but none of them would justify the
project alone: a durable local store that survives Safari's storage eviction;
first-class document import from Files/iCloud Drive; and a keyboard/number-entry
experience suited to typing five- or six-digit meter registers on a phone in a
hall cupboard.

### 2.3 What the app is deliberately not

Not a smart-home dashboard, not a live-usage monitor, not a switching broker, and
not a bill-payment app. It is a **low-frequency personal record with an
opinionated alarm on it** — a household opens it perhaps monthly to type two
numbers, and otherwise expects silence. That expectation shapes everything:
background work must be cheap and tolerant of long gaps, and a notification that
turns out not to be worth acting on is a serious product failure, not a minor
annoyance.

---

## 3. User journeys

Information architecture only; no screen design.

### 3.1 First launch — value before commitment

The app must be useful in under thirty seconds with **zero** personal data
entered. First launch lands directly on the comparison, pre-filled exactly as
the web app is (3,200 kWh, 60% night — the Consumer Council's stated typical
annual consumption, with the split flagged as an assumption the source does not
make). No onboarding carousel, no account, no permission prompts. Notification
and iCloud permissions are requested *at the moment they are first needed*, never
at launch.

A single dismissible prompt appears *after* the first successful comparison:
"Want this checked for you automatically? Add your current tariff." That is the
only nudge toward the personal layer.

### 3.2 Comparing tariffs (parity with web)

Identical inputs and outputs: estimate or actual usage; optional payment-method
filter; ranked list of distinct products; Year 1 and ongoing cost with "not
known" stated plainly where it is; the Economy 7 vs 24-hour verdict with its
mandatory availability caveat; dataset effective date and staleness banner.

Two iOS-specific affordances: results are the primary scroll surface rather than
a section below a form, and the per-result disclosure (credits, conditions,
cap explanation, warnings) is a sheet rather than an expander.

### 3.3 Recording the contract

Reachable from a result card ("I'm on this one" — pre-fills from the public
record but **copies the values**, see [§5](#5-contracted-tariff-data-model)) or
entered manually from a bill. Manual entry asks for the minimum that makes a
comparison possible — supplier, meter type, payment method, rates, standing
charge, start date — and treats everything else (term, exit fee, credits) as
optional with an explicit "not stated / don't know" that persists as `null`.

Replacing a contract never overwrites: the previous record is closed with an
`endDate` and retained.

### 3.4 Adding meter history

Three entry points, all optional:

- **First reading.** Two number fields and a date. The app explains that
  consumption cannot be shown until a second reading exists, so the first entry
  does not look broken.
- **Subsequent readings.** Shows derived consumption since the previous reading
  immediately, which is the reward loop that makes anyone bother.
- **CSV import.** The escape hatch for anyone with existing records
  ([§7](#7-csv-importexport-proposal)) — and the only way to get a useful
  personalised answer on day one.

### 3.5 Personal dashboard

Present only what is genuinely known, each labelled with how it was derived:

- Current contract (supplier, product, rates, start date, term/exit fee if known)
- Latest reading and consumption since the previous one
- Estimated annual consumption **plus its quality tier** ([§6.2](#62-usage-quality-tiers))
- Estimated annual cost on the current contract
- Best available alternative and the saving
- Dataset effective date

Where history is too short, the corresponding tiles say so instead of showing a
number. An annualised figure derived from six summer weeks of a storage-heated NI
household is not a worse estimate — it is a misleading one.

### 3.6 Tariff opportunity

An opportunity screen must answer, in this order: *how much*, *over what period*,
*why*, and *what could go wrong*.

- Saving, split into **first-year** (including welcome credits) and **ongoing**
- Effective first-year saving after any exit fee on the *current* contract
- The comparison basis: usage figure, where it came from, the window it covers
- Conditions on the new tariff: new-customers-only, term, exit fee, intro period
  and reversion, discount cap
- Any engine warnings, verbatim in plain language
- Dataset version, effective date and source link
- Actions: **Dismiss** (with a reason), **Remind me later**, **Mark as switched**

"Mark as switched" opens contract entry pre-filled from the new tariff — closing
the loop back to §3.3.

### 3.7 Data management

One screen, plainly worded: Export CSV; Import CSV; Backup/sync status (once
[§9](#9-icloudcloudkit-assessment) ships); Delete all personal data, with a
confirmation naming what will be destroyed and offering export first.

No dark patterns, no "are you sure you want to lose your data?" retention
theatre. Deleting must actually delete, including the CloudKit copy, and must say
what it cannot reach (an iCloud backup of the device itself).

---

## 4. Meter-reading data model

### 4.1 The central decision: store register readings, derive consumption

A reading is a **cumulative register value**, exactly as it appears on the meter.
Consumption is always derived from a pair of readings and never stored.

This matters more than it looks. Storing consumption would require the app to
decide, at entry time, what a decreasing reading meant — and that decision is
irreversible once the original number is discarded. Storing the register keeps
every interpretation revisable, makes imports idempotent, and means a correction
fixes one row rather than a chain.

### 4.2 Entities

Three types. Deliberately not more.

```
Meter  1 ──< MeterReading
Meter  1 ──< (import batches reference readings by id)
```

**`Meter`** — one physical meter installation.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `kind` | enum `economy7` \| `standard` | Matches the dataset's `meter_type` exactly |
| `label` | String? | User-facing, e.g. "Kitchen cupboard" |
| `installedOn` | Date? | Optional; unknown for most users |
| `removedOn` | Date? | Set when replaced; readings stay attached |
| `dayRegisterLabel` | String? | What the meter actually calls it — see §4.7 |
| `nightRegisterLabel` | String? | |
| `createdAt` / `updatedAt` | Date | |

**`MeterReading`**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `meterID` | UUID | Optional relationship (CloudKit requirement, §9.2) |
| `readOn` | Date | Date, normalised to midnight local time — see §4.4 |
| `dayRegister` | Decimal? | kWh |
| `nightRegister` | Decimal? | kWh; `nil` for a `standard` meter |
| `source` | enum `manual` \| `csvImport` \| `estimated` | Provenance |
| `importBatchID` | UUID? | Set for imported rows; enables whole-batch undo |
| `note` | String? | User's own annotation |
| `anomaly` | enum? `decrease` \| `duplicateDate` \| `largeJump` | Classified, not rejected — §4.5 |
| `createdAt` / `updatedAt` | Date | |

**`ImportBatch`** — `id`, `importedAt`, `fileName`, `rowCount`, `acceptedCount`,
`format`. Enough to say "23 readings imported from `meter.csv` on 4 March" and to
undo it. Not an audit log.

### 4.3 Decimal precision and units

Use Swift's `Decimal` (Core Data/SwiftData decimal storage), never `Double`.
Meter registers are decimal quantities that users compare against a printed
number; `0.1 + 0.2` arithmetic artefacts in a value the user can read off a
display destroy trust in everything else.

Units are **kWh**, always, with no unit field. NI domestic electricity meters
read in kWh; a unit column would be a field that is always the same value and
occasionally wrong.

Store the register to **one decimal place** as entered, but do not *enforce* it:
meters vary, and rejecting a legitimate second decimal place to satisfy a schema
is a bad trade. Validate range (non-negative, sane magnitude), not precision.

Note for the Swift port: the tariff engine itself runs in binary floating point
(`src/calc.js` is JavaScript). Reading storage uses `Decimal`; the derived
`{annualDayKwh, annualNightKwh}` pair is converted to `Double` at the boundary
before it enters the shared calculation, so both platforms compute on the same
representation. Converting the *engine* to decimal arithmetic would be a
divergence from the reference implementation and is explicitly out of scope.

### 4.4 Date and time: date-only, not timestamp

Store `readOn` as a date at local midnight, not an instant. Users do not record
the time they read a meter, and a timestamp invites a false precision that
produces absurd results ("1.3 kWh/day" computed across a 23-hour interval). The
day-granularity error over a twelve-month window is immaterial.

Consequence: two readings on the same date are a duplicate to be resolved
([§4.5](#45-validation-anomalies-are-classified-not-rejected)), not two points in
a series.

### 4.5 Validation: anomalies are classified, not rejected

A decreasing register is a real event with at least four ordinary causes — a
typo, a meter replacement, a register rollover, or a day/night transposition —
and the app cannot tell them apart. **Never silently reject, never silently
accept.** Flag the reading, keep it, and ask:

| The user says | The app does |
|---|---|
| "I mistyped it" | Opens the value for correction |
| "The meter was replaced" | Offers to create a new `Meter` and move this and later readings onto it |
| "The meter rolled over" | Records the anomaly; consumption across that pair is computed with the rollover accounted for, flagged as estimated |
| "I don't know" | Keeps the reading, excludes the *affected interval* from consumption totals, marks the usage estimate as reduced quality |

The final row is the important one. An unexplained anomaly must degrade the usage
estimate's quality tier ([§6.2](#62-usage-quality-tiers)), not be quietly
smoothed over.

Meter **replacement is a new `Meter`**, not a flag on a reading. This keeps
monotonicity a simple within-series invariant, keeps register sequences honest,
and means consumption is never computed across an installation boundary — which
would be meaningless.

**Duplicates**: same `meterID` + same `readOn`. On manual entry, offer to replace.
On import, default to skip and report ([§7.5](#75-preview-before-import-is-mandatory)).

**Irregular intervals and gaps** need no special handling by design: consumption
is computed per interval between consecutive readings, and a long interval is
simply a long interval. What *must* be handled is not pretending a gap is
uniform — see [§6.3](#63-what-the-app-must-not-do).

No corrections table. Editing a reading updates it and bumps `updatedAt`. A
version history of a household's meter readings is over-engineering for a
one-person project; the undoable unit that genuinely matters is the *import
batch*, and that is modelled.

### 4.6 Should the standard single-rate meter be supported now?

**Model it now. Build the UI for it later.**

The argument for deferring is that the app's audience is Economy 7 households and
a nullable `nightRegister` is a small complication. The arguments against
deferring are stronger, and one of them is decisive:

- The web engine **already** prices both families, and `compareMeterTypes()`
  exists precisely so a user can discover a 24-hour tariff would suit them
  better. A user who acts on that advice and switches meters would find their own
  app unable to record the new meter.
- Adding `kind` later is a schema migration — and under CloudKit, schemas are
  *additive only* after production promotion ([§9.2](#92-the-constraints-apple-documents)).
  Adding a field is possible; changing the meaning of an existing model is not.
- The cost today is one enum and one optional field.

So: `Meter.kind` and a nullable `nightRegister` exist from the first schema.
Reading entry shows one field or two accordingly. Nothing else in the app needs
to know.

### 4.7 Register labelling — an unresolved real-world problem

NI Economy 7 meters do not consistently print "day" and "night". Users encounter
"Rate 1/Rate 2", "Normal/Low", unlabelled registers, and installations where the
low-rate register is wired to a storage heater circuit only. A user who
transposes day and night produces a plausible-looking but badly wrong comparison
— the night rate is roughly half the day rate, so the error is expensive and
invisible.

Mitigations to prototype, not to assume: capture the user's own register labels
on the `Meter`; sanity-check the derived night share against the plausible range
for a storage-heated NI household and query anything extreme; and show the
derived day/night split back to the user in plain words before it is used
(the web app already does this, in `updateUsageHint`). Flagged as a research
item in [§18.4](#184-register-labelling-and-user-error).

---

## 5. Contracted-tariff data model

### 5.1 The rule that makes the requirement structural

> **A contracted tariff is a value snapshot, copied at the moment of recording.
> It never holds a live reference to a public tariff record.**

Storing `publicTariffID` and resolving rates at read time would mean a routine
monthly dataset update silently rewrites the user's contract — the exact failure
the issue names. Copying makes that impossible rather than merely discouraged: the
public dataset is a separate store the personal store never reads through.

The public id *is* kept, in a `provenance` block, as evidence of where the numbers
came from. It is never dereferenced for pricing.

### 5.2 Shape: deliberately the engine's own shape

The engine's tariff record already carries everything a contract needs.
Reusing that shape means the user's contract is priced by `costFor()` — the same
function, the same Year 1 and ongoing semantics, the same credit and cap rules —
with **no second calculator**.

```
ContractedTariff
├─ id                 UUID
├─ supplier           String
├─ productName        String?        // "don't know" is legitimate
├─ meterKind          economy7 | standard
├─ paymentMethod      one of the five dataset payment_method values
├─ rateBasis          standard | discounted     // mirrors rate_basis
├─ dayRatePPerKwh     Decimal?       // economy7
├─ nightRatePPerKwh   Decimal?       // economy7
├─ unitRatePPerKwh    Decimal?       // standard
├─ standingPPerDay    Decimal
├─ startDate          Date
├─ endDate            Date?          // nil = current contract
├─ contractType       fixed | variable | unknown
├─ termMonths         Int?           // null = not stated
├─ exitFeeGbp         Decimal?       // null = unknown, 0 = confirmed none
├─ adjustments        [ContractAdjustment]
├─ provenance         Provenance
├─ recordedAt         Date
└─ updatedAt          Date
```

`ContractAdjustment` mirrors the dataset's `adjustments` array — the same `type`
vocabulary (`welcome_credit`, `recurring_credit`, `fixed_charge`,
`percentage_discount`, `discount_cap`), the same `applies` scopes. In practice
only welcome credits and recurring credits will be entered by hand; the rest
arrive via pre-fill from a public record.

`Provenance` is `{ sourceKind: manual | publicDataset | ..., sourceTariffID: String?,
sourceDatasetFile: String?, sourceDatasetEffectiveFrom: Date?, userNote: String?,
evidenceImageID: UUID? }`. An optional photo of the bill is a genuinely useful
memory aid; it is a local file, never uploaded anywhere the user has not chosen.

### 5.3 Null discipline

Every optional field above carries the dataset's own meaning: `null` is
*unknown*, `0`/`false` is *known to be none*. Contract-entry UI must therefore
offer a distinct "not stated on my bill" choice rather than letting an empty
field become zero — and the difference must be visible downstream, because
"no exit fee" and "exit fee unknown" lead to different advice
([§6.5](#65-exit-fees-year-1-and-ongoing)).

### 5.4 Contract history

Contracts are never deleted on replacement; `endDate` is set and a new record
created. `startDate`/`endDate` must not overlap for a given meter, and the app
should refuse an overlap rather than resolving it.

Retaining history enables, later and cheaply: what the user actually paid over a
past period (readings × the contract in force at the time); whether a past switch
delivered the saving it promised; and whether a fixed term is about to end. The
last of these is arguably the *best* notification the app could send and needs no
tariff data at all — see [§10.6](#106-a-second-notification-worth-more-than-the-first).

### 5.5 Pricing the contract: the projection

```
ContractedTariff ──project──▶ { tariff-record shape } ──costFor()──▶ annual cost
```

The projection is a pure mapping with no arithmetic in it. Two consequences worth
stating:

- The contract is priced by **the same code** that prices every public tariff, so
  a saving is always a difference between two figures computed identically. A
  saving computed from two different calculators is not a saving; it is an
  artefact.
- A contract whose `intro_period_months` is unknown produces
  `ongoingKnown == false` from the engine, automatically — and that must suppress
  notification ([§10.4](#104-when-not-to-notify)). The honesty machinery already
  exists; the app inherits it.

---

## 6. Personalised comparison model

### 6.1 Deriving usage from readings

```
readings (per meter, ordered by readOn)
   → intervals: (Δday kWh, Δnight kWh, Δdays)
   → select window
   → annualise
   → { annualDayKwh, annualNightKwh }   ← the engine's canonical shape
   → compare() / costFor(), entirely unchanged
```

**Window selection, in order of preference:**

1. **Latest complete 365-day window.** The most recent reading, back to the
   reading nearest 365 days earlier. Full seasonal cycle; no annualisation
   arithmetic at all beyond pro-rating the boundary interval.
2. **Rolling annual with partial boundary intervals.** Where no reading falls
   near the 365-day mark, pro-rate the interval that straddles it, assuming
   uniform consumption *within that one interval only*. Acceptable because the
   error is confined to a fraction of one interval.
3. **Longest available window ≥ 90 days**, scaled to 365. Labelled `partial`.
   Explicitly caveated for season ([§6.3](#63-what-the-app-must-not-do)).
4. **Under 90 days: do not personalise.** Fall back to the web app's estimate
   inputs and say why.

Intervals containing an unexplained anomaly ([§4.5](#45-validation-anomalies-are-classified-not-rejected))
are excluded from the window and reduce its quality tier.

### 6.2 Usage quality tiers

One enum, surfaced everywhere a personalised figure appears, and consulted before
any notification:

| Tier | Condition | Use |
|---|---|---|
| `measured` | ≥ 350 days covered, no unexplained anomalies, both registers present | Personalise; notifications allowed |
| `partial` | 90–349 days | Personalise **with a visible seasonal caveat**; notifications allowed only above a raised threshold (§10.4) |
| `insufficient` | < 90 days, or gaps > 25% of the window, or unresolved anomalies | Do not personalise; offer estimate mode |
| `none` | No readings | Estimate mode, as web |

The 350/90-day boundaries are **judgement, not evidence**. 350 rather than 365
tolerates a user who reads their meter on a slightly different day each year; 90
is a guess at the shortest window worth extrapolating at all. Both are candidates
for revision after real use ([§18.5](#185-thresholds-and-boundaries-are-unvalidated-guesses)).

### 6.3 What the app must not do

**Do not scale a short window to a year without saying so.** Northern Ireland's
Economy 7 population is disproportionately storage-heated. A household's
November–February consumption can be several times its June–September
consumption. Annualising ten summer weeks understates the year badly, and
understating consumption systematically favours tariffs with low standing charges
and high unit rates — a *directional* error, not a random one. Hence `partial`
carries a caveat that names the months covered.

**Do not build a seasonal adjustment model.** Degree-day weighting or a synthetic
NI load profile would mean the iOS app computing a usage figure the web app
cannot reproduce — the first crack in exactly the shared-behaviour discipline
[§11](#11-shared-webios-calculation-strategy) exists to protect. If seasonal
normalisation is ever wanted, it belongs in the shared specification, applied to
both platforms, with conformance vectors. Deferred
([§19](#19-explicitly-deferred-features)).

**Do not infer a day/night split when only one register is available.** The web
app's estimate mode already asks the user for a night share, with the assumption
visible. That is more honest than a derived number wearing the authority of a
measurement.

### 6.4 Reusing web semantics rather than reimplementing them

The personal layer's entire contribution is producing two numbers. Everything
after that point is the existing engine, reached through
`usageFromAnnualDayNight`, which exists in `src/calc.js` today and is documented
as the canonical shape. The Swift app calls its port of the same function with
the same arguments and gets the same answer — verified by conformance vectors,
not by hope.

Concretely, **nothing in this section changes any calculation.** It changes only
where the usage figure comes from.

One consequence is worth recording: a meter ledger *would* make the documented
quarterly-discount-cap limitation in `docs/DATA.md` solvable, because quarterly
consumption becomes knowable. That is a genuine future improvement — and it must
be made as a **shared engine change** (specification + vectors + both platforms),
never as an iOS-only refinement. Listed as deferred, deliberately.

### 6.5 Exit fees, Year 1 and ongoing

The web engine's rule R3 is that exit fees are *disclosed, never costed*, because
they are payable only on early exit and belong to the tariff being left, not the
one being joined. That rule is correct and stays.

But a switching decision genuinely does turn on the exit fee of the contract the
user is **currently in** — which the app knows and the web app never can. This is
resolved as a presentation-layer calculation over unchanged engine output, not as
an engine change:

| Figure | Definition |
|---|---|
| Gross annual saving | Current contract annual cost − candidate annual cost, ongoing basis |
| First-year saving | Same, on the engine's Year 1 basis (includes welcome credits) |
| Ongoing saving | Same, on the engine's ongoing basis; **unavailable when `ongoingKnown == false`** |
| Effective first-year saving | First-year saving − exit fee on the *current* contract, where the exit fee is known **and** the term has not expired |
| Confidence | Derived from usage tier + engine warnings (§6.6) |

Where the exit fee is `null` (unknown), the effective figure is **not computed**
and the screen says the exit fee is unknown. Substituting zero would turn "we
don't know" into "there isn't one" — the precise error `null`-discipline exists to
prevent.

### 6.6 Confidence, and avoiding false precision

Confidence is assembled from signals the engine already emits, not invented:

- usage quality tier ([§6.2](#62-usage-quality-tiers))
- `result.ongoingKnown`, `result.year1.complete`, `result.introPeriodKnown`
- presence of `warnings` (`reversion_unknown`, `reverts_to_missing`,
  `reversion_payment_method_differs`, `cap_standard_rate_missing`)
- `discountCap.applied` together with the documented quarterly-threshold caveat
- dataset staleness from `datasetStatus()` — already implemented in `src/format.js`
- `conditions_verified` on the dataset, and `newCustomersOnly == null` on the
  candidate

Display rule: **round savings to the nearest £, never to the penny.** A £-and-p
saving computed from an annualised estimate claims a precision the inputs cannot
support. The engine keeps full precision internally, exactly as it does today;
rounding stays a display concern.

---

## 7. CSV import/export proposal

### 7.1 Canonical format — one format, written and read

```csv
Date,Day reading,Night reading
2026-01-01,12345.6,6789.1
2026-02-01,12610.4,6903.7
```

- UTF-8, no BOM on export (tolerated on import)
- `YYYY-MM-DD` dates
- `.` decimal separator, `,` field delimiter
- LF line endings on export (CRLF tolerated on import)
- Header row required
- One row per reading, ascending by date
- `Night reading` empty for a standard meter

Export writes exactly this. Import accepts a documented superset
([§7.3](#73-import-accepts-a-documented-superset)). Round-tripping an export
through import must be lossless and idempotent.

### 7.2 Should Numbers and Excel files be supported directly? No

Both applications export CSV competently, and `.xlsx` is a ZIP archive of XML
requiring either a third-party dependency or a non-trivial parser. For a
one-person project maintaining a repository that currently has **zero runtime
dependencies and no build step**, that is a poor trade: a permanent maintenance
and supply-chain cost to save the user one menu command.

Recommendation: document "Export as CSV" for Numbers, Excel and Google Sheets in
one short help screen. Revisit only if real users actually get stuck — and that
is an evidence question, not an architecture one.

### 7.3 Import accepts a documented superset

| Variation | Handling |
|---|---|
| BOM | Stripped |
| CRLF / CR | Normalised |
| Header case/spacing | Matched case-insensitively, whitespace-trimmed |
| Column aliases | `Date`/`Reading date`/`Read date`; `Day`/`Day reading`/`Rate 1`/`Normal`; `Night`/`Night reading`/`Rate 2`/`Low` |
| Column order | Resolved by header name, not position |
| Extra columns | Ignored, reported in the preview |
| Quoted fields, embedded commas | RFC 4180 quoting supported |
| Blank lines | Skipped |
| Thousands separators (`12,345.6`) | Accepted inside quotes; see §7.4 |
| `;` delimiter with `,` decimals | Detected and handled (§7.4) |

Header matching is by name because a file whose columns are in a different order
is otherwise silently transposed — day read as night — which is the single worst
outcome import can produce.

### 7.4 The two genuinely hard cases

**European locale exports.** Excel in many locales writes `;` as the delimiter and
`,` as the decimal separator: `2026-01-01;12345,6;6789,1`. Detect by sniffing the
header line — if it contains `;` and no `,`, treat the file as semicolon-delimited
with comma decimals. This is deterministic for well-formed files and fails
visibly rather than subtly for malformed ones.

**Ambiguous dates.** `01/02/2026` is 1 February in the UK and 2 January in the US,
and **no heuristic resolves this reliably**. Scanning for a value > 12 in the
first component works only when the file happens to contain one; a year of
monthly readings taken on the 3rd of the month never does.

The right answer is to ask, once per file, and not to guess:

1. If all dates are ISO `YYYY-MM-DD`, parse directly and ask nothing.
2. If any date is unambiguous (a component > 12), apply that order to the whole
   file and state the inference in the preview.
3. Otherwise, prompt once: "Is `01/02/2026` 1 February or 2 January?" and apply
   the answer to the file.

Never fall back to device locale silently. A user with a US-locale device
importing a UK spreadsheet would get twelve readings scattered across the wrong
months, and nothing on screen would look wrong.

### 7.5 Preview before import is mandatory

Import never writes without confirmation. The preview shows every parsed row with
a status:

| Status | Meaning | Default |
|---|---|---|
| New | Parses, no conflict | Import |
| Duplicate | Same meter + date exists | Skip |
| Decreasing | Register below the previous reading | Import, flagged (§4.5) |
| Large jump | Implausible consumption vs the user's own history | Import, flagged |
| Invalid | Unparseable date or number, missing required field | Skip, with the reason and line number |

Per-row toggles; a summary line ("19 new, 3 duplicates skipped, 1 invalid on line
14"); and a partial import is allowed — refusing 200 good rows because of one bad
one is hostile. Every accepted row carries the batch id, so the whole import is
undoable as a unit. The source file itself is **not** retained: `fileName` and
`importedAt` are enough provenance, and keeping copies of user documents is a
privacy cost with little benefit.

### 7.6 iOS mechanics

SwiftUI's `fileImporter` presents the system document picker; the app declares
`UTType.commaSeparatedText` (identifier `public.comma-separated-values-text`,
per Apple's documentation) and also accepts `.plainText`/`.text`, because
exporters and cloud-storage apps routinely mislabel CSV. Parsing is a small
hand-written RFC 4180 reader — a few dozen lines, no dependency, matching the
repository's existing posture of preferring small auditable code to libraries.

Export writes to a temporary file and offers the standard share sheet, letting
the user route it to Files, iCloud Drive, Mail or anywhere else. The app needs no
special entitlement and no network access to do this.

---

## 8. Local storage proposal

### 8.1 Volume, and what it implies

A diligent household entering a reading monthly for a decade produces about 120
reading rows and perhaps a dozen contract records. This is a *small* dataset by
any measure, which means performance is not a selection criterion and should not
be allowed to masquerade as one.

### 8.2 Options

**Codable JSON files.** Trivially simple, trivially exportable, no framework
risk. But every query is hand-written, SwiftUI observation is manual, concurrent
writes need care, and there is no migration story beyond hand-rolled version
handling. Critically, there is **no path to iCloud sync** short of writing one.

**Core Data.** Mature, dependable, `NSPersistentCloudKitContainer` well-trodden.
Verbose in SwiftUI, and the modelling ceremony is disproportionate here.

**SwiftData.** Declarative models, native SwiftUI integration, and — per Apple's
documentation — it is built on `NSPersistentCloudKitContainer`, so the CloudKit
path is a capability and a configuration rather than a rewrite. It requires
iOS 17+. Its drawback is maturity: it is a younger framework than Core Data and
has accumulated a reputation for rough edges, particularly around CloudKit.

**Recommendation: SwiftData**, for one reason above all — it makes
[§9](#9-icloudcloudkit-assessment) a later decision rather than a rewrite, and
this document's whole staging argument depends on being able to defer sync
without foreclosing it. The risk is acknowledged and is a named spike in
[§18.2](#182-swiftdata--cloudkit-dependability).

**Deployment target.** iOS 17 is the floor imposed by SwiftData. As of September
2026, iOS 26 is current and iOS 27 is released 14 September 2026, so an iOS 17
floor is conservative and costs nothing in modern API availability. Whether to
raise it should be decided at implementation time against then-current adoption
figures, not fixed here.

### 8.3 Design under CloudKit's constraints, from day one

Even if CloudKit is never enabled, build the schema to CloudKit's rules, because
retrofitting them later means a migration in the one place migrations are worst
([§9.2](#92-the-constraints-apple-documents)):

- **Every attribute optional or defaulted.**
- **No `@Attribute(.unique)`.** Uniqueness is enforced in application code: a
  derived natural key (`meterID` + `readOn`) with a fetch-before-insert. Slower;
  irrelevant at 120 rows.
- **Every relationship optional**, with inverses set explicitly.
- **No `.deny` delete rule.**
- Additive-only thinking in every model decision: prefer a new optional field
  over changing the meaning of an existing one, always.

### 8.4 Encryption at rest

Apple documents that iOS data protection is automatic once the user sets a
passcode, with a default protection level of *complete until first user
authentication*. For this app that default is the **right** choice, and
tightening it would be a mistake: `.complete` makes files unreadable while the
device is locked, which would break the background refresh that
[§10](#10-notification-architecture) depends on — the app would be woken when it
cannot read its own data.

So: keep the default; do not add a bespoke encryption layer; do not put meter
readings in the Keychain (per Apple's documentation, it is for small secrets —
passwords, keys, certificates — not household records). If an app-level passcode
or Face ID lock is ever wanted, that is an access-control feature layered on top,
not a change to storage, and it is deferred.

---

## 9. iCloud/CloudKit assessment

### 9.1 Can the app work perfectly without it? Yes — and it must

This is the acceptance test for the whole feature. Personal data lives in a local
store; every screen reads from that store; nothing waits on a network. iCloud adds
a second device and a recovery path. It adds nothing a single-device user needs,
and the app must never behave as though it does: no nag screens, no "sync your
data to continue", no degraded state for declining it.

### 9.2 The constraints Apple documents

From Apple's *Syncing model data across a person's devices*:

- Two capabilities are required: **iCloud** (CloudKit) and **Background Modes**
  with *Remote notifications*, the latter so CloudKit can deliver silent change
  notifications.
- The iCloud capability **requires an active Apple Developer account with admin
  permissions** — so this is not available to a free-provisioning hobby build.
- **Unique constraints are unsupported**, because sync happens concurrently.
- **All relationships must be optional**, because the servers do not guarantee
  atomic relationship processing; inverses should be set explicitly because
  CloudKit processes changes in an indeterminate order. The `.deny` delete rule
  is unsupported.
- **CloudKit schemas are additive only.** After promotion to production you
  cannot delete model types or change existing model attributes.

That last point is the one that should govern the decision, and it is worth
stating bluntly: **promoting a CloudKit schema to production is close to
irreversible.** It is a commitment to live with the model's mistakes. That is a
strong argument for shipping several versions locally first and promoting only a
model the app has actually exercised — which is exactly the staging in
[§17](#17-recommended-staged-mvp).

Apple's Core Data mirroring documentation adds that sync uses a record zone in
the **private** database, accessible only to the signed-in user, and that
existing CloudKit containers are incompatible with a Core Data-owned schema.

### 9.3 What syncs, and what does not

| Data | Synced | Why |
|---|---|---|
| Meter readings | Yes | The irreplaceable data |
| Meters | Yes | Readings are meaningless without them |
| Contracted tariffs (incl. history) | Yes | Hand-entered, hard to recreate |
| Import batch metadata | Yes | Small; keeps undo coherent |
| Evidence images | **No, initially** | Bill photos may contain account numbers and addresses; syncing them multiplies the exposure of the most sensitive artefact for the least benefit |
| Cached tariff dataset | No | Re-downloadable; syncing wastes quota |
| Opportunity/dismissal state | **No, initially** | Device-local is acceptable; see §9.4 |
| Notification preferences | No | Per-device by nature |

Opportunity state not syncing means a two-device user can be notified twice about
the same opportunity. That is a mild annoyance with a cheap later fix (sync a
small dismissal record), and it is deliberately not solved in the first sync
release.

### 9.4 Sync, backup, or both?

CloudKit mirroring is genuinely **both**, but it is a *weak* backup, and the
distinction matters:

- It is **not** a point-in-time snapshot. A deletion propagates. An accidental
  "delete all" on one device destroys the data on every device and in iCloud.
- It is **tied to an Apple ID**. Changing Apple ID means the new account sees an
  empty store; the old data remains in the old account's private database and is
  not migrated.
- It is **opaque**. Users cannot browse or extract it independently.

Therefore: **CSV export is the real backup mechanism, and it must ship first.**
This is a substantive reordering of the suggested phase sequence, and the
reasoning is that the risk being mitigated — losing two years of readings — is
fully addressed by a file the user controls, at perhaps a twentieth of the
complexity and with none of the irreversibility.

### 9.5 Multi-device, conflicts, reinstall, unavailability

**Multiple devices** on one Apple ID converge automatically. Convergence is
eventual, not immediate.

**Conflicts.** `NSPersistentCloudKitContainer` resolves at property granularity,
last-writer-wins. For this data that is almost always adequate — two devices
rarely edit the same reading — but two consequences must be designed for: readings
created independently on two devices for the same date can both arrive
(deduplicate on the natural key *after* merge, not only before insert), and an
edit made offline on one device can lose to a later edit on another. Neither is
worth a custom merge policy at this scale; both are worth a test.

**Reinstall.** With sync on and the same Apple ID, data returns. With sync off,
**the data is gone** — app deletion removes the container. This must be said
plainly in the data-management screen, not buried. It is the strongest
user-facing argument for export.

**iCloud unavailable** (signed out, storage full, offline, restricted): the app
continues on local storage with no loss of function, and surfaces sync state
honestly — "Last synced 3 days ago" or "Not syncing: iCloud storage full" — never
a silent failure. A sync that quietly stops is worse than no sync, because the
user believes they are protected.

**Apple ID change.** The new account starts empty. The app should detect the
change and offer export-then-import as the migration path, because no automatic
one exists.

### 9.6 Verdict

**Adopt CloudKit — as an optional, off-by-default, late-phase enhancement, with
the schema designed for it from day one.** Not because sync is essential, but
because designing around its constraints is nearly free now and impossible later,
and because a two-device household is a real and ordinary case.

Ship export first. Promote the schema to production only once the local model has
survived real use.

---

## 10. Notification architecture

### 10.1 The requirement, stated precisely

> Tell me when a currently available tariff is **enough** better for **my**
> circumstances to be worth acting on.

Two words carry the weight. *Enough* means a threshold the user sets. *My* means
the comparison runs against the user's own contract and own consumption — data
that must never leave the device.

### 10.2 Why push is the wrong answer here

Apple's documentation is explicit that remote notifications begin with a
**provider server** you operate, which holds device tokens, maintains an HTTP/2
connection to APNs, and authenticates by token or certificate. Adopting push
would mean:

- operating and securing a server indefinitely, for a hobby project
- holding a device-token registry — the app's first piece of per-user state
- either sending a generic "new data" ping (in which case the phone still has to
  do the work locally, so the server bought only latency), **or** computing
  savings server-side, which would require uploading the user's meter history
  and contract — destroying the privacy model outright

The second option is disqualified on principle. The first is disqualified on
cost/benefit: it buys minutes of latency on a dataset that changes roughly
monthly.

Apple further documents that silent background pushes are rate-limited above
three per hour and that priority-5 notifications may be grouped, throttled or
stored — so push is best-effort too. It is not the reliable channel that would
justify its cost.

**Conclusion: no backend. Not now, and not for this feature.**

### 10.3 The local architecture

```
BGAppRefreshTask fires (system-chosen time)
   │
   ├─ conditional GET data/latest.json  (ETag / If-None-Match)
   ├─ 304 Not Modified → done, reschedule, exit          ← the common case
   │
   ├─ new dataset → download, validate (ported validate.js), cache
   ├─ derive usage from local readings          (§6)
   ├─ price the user's contract via costFor()   (§5.5)
   ├─ compare() against the new dataset
   ├─ apply the notify/don't-notify rules       (§10.4)
   └─ if warranted → schedule a LOCAL notification, record the Opportunity
```

Everything after the download is on-device arithmetic over a few hundred
kilobytes. Nothing personal is transmitted; the only network request is an
anonymous GET of a static public file that any browser can already fetch.

Apple documents that for `BGAppRefreshTask` *"the system decides the best time to
launch your background task, and provides your app up to 30 seconds of background
runtime"*, and that the `fetch` background mode capability is required. Thirty
seconds is ample: the payload is small and the computation is a loop over a few
dozen tariffs.

**The honest caveat**: the system decides *whether and when*, weighing usage
patterns, battery and network. An app opened monthly may be refreshed
infrequently. Three things make that acceptable:

- The same check runs on **every foreground launch**, so opening the app is
  always authoritative.
- A `UNCalendarNotificationTrigger` can fire a **local** reminder on a user-chosen
  cadence ("check my tariff quarterly") with no background execution at all —
  Apple documents local notifications as scheduled and delivered by the system
  independently of whether the app is running.
- Delay costs *timeliness*, never *correctness*. A saving found four days late is
  still the same saving; tariff changes here are monthly, and switching is not
  time-critical.

Measuring the real cadence is the top prototype priority
([§18.1](#181-background-refresh-cadence--highest-prototype-priority)).

### 10.4 When *not* to notify

More important than the trigger. Suppress entirely when **any** holds:

| Condition | Why |
|---|---|
| Usage tier is `insufficient` or `none` | No basis for a personal claim |
| No current contract recorded | Nothing to compare against |
| `ongoingKnown == false` on the candidate | Cannot claim a durable saving |
| `year1.complete == false` | The engine says Year 1 is understated |
| Dataset staleness is `error` (>60 days) | `src/format.js` already says these rates must not be used to choose a tariff |
| `newCustomersOnly == true` and the user is already with that supplier | Not available to them |
| Candidate's payment method differs from the contract's and the user has not opted into method-switching suggestions | Changing how you pay is a real-world decision, not a free win |
| Saving below the user's threshold | By definition |
| Usage tier is `partial` and the saving is below **2×** the threshold | A short window's error can exceed a small saving; require a bigger margin for a weaker estimate |
| The same opportunity was notified recently | §10.5 |
| More than one notification in the past 7 days | Hard frequency cap |

The `partial` multiplier deserves emphasis: it makes the *confidence of the
estimate* modulate the *bar for acting on it*. That is the single design decision
that most protects the product from the failure mode of crying wolf.

### 10.5 Deduplication

An `Opportunity` record: `{ id, signature, tariffID, paymentMethod, firstSeenAt,
lastNotifiedAt, notifiedSavingGbp, state: new|notified|dismissed|acted,
dismissedUntil, dismissReason }`.

`signature` is a hash of *what the advice depends on* — tariff id, payment method,
the rate values and adjustments actually used, the usage basis — deliberately
**not** the dataset version. A dataset republished with identical rates must not
resurrect a dismissed opportunity.

Re-notify only when at least one is true:

- the saving has improved by ≥ 25% over `notifiedSavingGbp`
- the user's contract has changed since the last notification
- a dismissal has expired (default 90 days; "never" is also offered)
- the signature changed materially (the tariff's own rates moved)

### 10.6 A second notification worth more than the first

The app will know the user's contract `termMonths` and `startDate`. **"Your fixed
term ends in 30 days"** requires no tariff data, no background fetch and no
network — a single `UNCalendarNotificationTrigger` scheduled at contract-entry
time — and it fires at the one moment a switch is cheapest and most consequential
(no exit fee, and a reversion rate about to apply).

This is materially easier than the saving alert and arguably more useful. It
should ship **first**, in the same phase as contract recording, as a genuine
feature and as a low-risk proving ground for the notification permission flow.

### 10.7 Thresholds

The user sets a minimum annual saving. A suggested default of **£50/year** is
offered — large enough that acting on it is worth an afternoon of admin, small
enough to be reachable. That figure is a **guess** and is flagged as such
([§18.5](#185-thresholds-and-boundaries-are-unvalidated-guesses)).

The notification text states the number and the basis, never a bare claim:

> **£112/year cheaper available**
> Based on your readings for the last 12 months. Tap to see the details and
> conditions.

Never "Switch now". Never a supplier's name in the notification body — the
`conditions_verified` and eligibility caveats mean the app cannot promise a
tariff is actually available to a given household, and a lock-screen banner has
no room for that caveat.

### 10.8 If local refresh proves insufficient

A pre-decided escalation path, with a trigger condition rather than a hunch: if
prototyping shows median time-to-notify exceeding ~2 weeks for realistic usage
patterns, consider a **silent background push carrying no personal data** — a
"dataset v47 published" ping that causes the phone to run the same local
computation. That still needs a provider server, and is still a real ongoing
cost; it is listed as a contingency, not a plan, and would need a separate
decision.

---

## 11. Shared web/iOS calculation strategy

### 11.1 The risk

Two implementations of tariff arithmetic will drift. Not might — will. The
question is only whether drift is **detected**. A discrepancy of a few pounds
between the website and the app on the same inputs would be a credibility failure
neither platform recovers from easily, and the repository has already invested
heavily (`intro_period_basis`, the double-discount guard, the dangling-cap
rejection) in making *this class of silent error structurally impossible*.

### 11.2 Options assessed

| Option | Assessment |
|---|---|
| **JavaScriptCore, bundling `calc.js`** | One implementation, genuinely no drift. But `JSContext` does not load ES modules, so the source needs bundling — introducing a build step to a repository whose zero-build nature is a stated design property. Marshalling results into Swift types is boilerplate that can itself drift; debugging spans two languages; and every personal-layer feature still needs Swift alongside. Rejected as a poor fit, not as unworkable. |
| **WebAssembly** | Swift/Wasm interop plus a toolchain, for a few hundred lines of arithmetic. Disproportionate. |
| **Server-side calculation** | Reintroduces the backend the whole design avoids, and would require uploading personal data. Disqualified. |
| **Rewrite in Swift, both platforms consume it** | Would mean compiling Swift to Wasm for the web, replacing a working, dependency-free, auditable JavaScript engine. Backwards. |
| **Independent Swift port + shared generated conformance vectors** | Accepts duplication and makes drift *detectable and reviewed*. **Recommended.** |

### 11.3 Recommendation: conformance vectors

**`src/calc.js` is normative.** The Swift implementation is a port that must
reproduce it.

Proposed mechanism, all inside this repository:

```
test/fixtures.js  ──┐
data/tariffs-*.json ├──▶ scripts/calc-vectors/generate.mjs ──▶ spec/calc-vectors.json
                    │                                              │
                    │                                    ┌─────────┴──────────┐
                    │                                    ▼                    ▼
                    └── CI: regenerate & diff       JS conformance test   Swift test target
```

**`spec/calc-vectors.json`** — a version-controlled file of
`{ id, description, dataset, options, expected }` cases. `expected` holds the
full-precision values the engine currently produces: `year1.total`,
`year1.energyCost`, `year1.standingCost`, `year1.creditsApplied`, ongoing figures
or an explicit `ongoingKnown: false`, ranking order, tie sets, cap adjustments,
and warning `code`s.

Three properties make this work:

1. **Generated, never hand-written.** Generated from the existing fixtures, so
   the vectors cannot disagree with the tests that already guard the engine.
2. **Committed.** A behaviour change shows up as a diff in `spec/`, in review, in
   the same pull request as the code change. Drift becomes *visible*.
3. **CI-enforced.** A check regenerates the vectors and fails if the committed
   file differs. It is then impossible to change calculation semantics without
   the vector diff appearing — which is the same discipline `docs/DATA.md` and
   the reconciliation documents already apply to *data*, extended to *behaviour*.

The Swift package's test target reads the same JSON and asserts the same values
within a documented tolerance. Any divergence fails a build on one side or the
other.

**Tolerance.** Both platforms use IEEE 754 doubles, so results should agree to
near machine precision. Use an absolute tolerance of `1e-9` on pound values — and
match the engine's existing `TIE_EPSILON` (`1e-4`) exactly when asserting *ranking
and tie* behaviour, since ordering, not arithmetic, is what that constant governs.

**Coverage the vectors must include**, because these are where a port silently
diverges:

- `intro_period_months` of `0`, `null`, `< 12` with and without `reverts_to`,
  and `>= 12`
- `rate_basis: discounted` vs a calculated `percentage_discount`, and
  `applies_to` of `all`/`day`/`night`
- credits with stated and unspecified timing; `creditExceedsCost`
- `discount_cap` biting and not biting; `max_saving_gbp` never exceeded
- payment-method ties, including the all-methods-tie case
- both meter types, including that a `standard` tariff's cost is invariant to the
  day/night split
- ranking determinism (the `supplier`/`name` tiebreak)
- **validation outcomes**, not just costs: which records are rejected, and with
  which error `code`s. A Swift port that *accepts* a record the JS validator
  rejects is the most dangerous divergence of all, because it prices something
  the reference implementation refuses to price.

### 11.4 A written specification alongside the vectors

Vectors prove *what*; they do not explain *why*. A `docs/CALCULATION-SPEC.md`
should state the rules in prose — R1 (unknown is never faked), R2 (Year 1
blending), R3 (exit fees disclosed not costed), R4 (credits reported not
clamped), R5 (spreadable vs one-off), R6 (no double discounting), R7 (deterministic
ordering) — as they already appear in comments across `src/calc.js`. That is a
**Phase 0 deliverable**, intentionally not written here: this document is an
exploration, and extracting the specification is implementation work that should
happen when the port begins.

### 11.5 Sharing the data schema

The tariff JSON is consumed directly by iOS: same files, same field names, decoded
into Swift `Codable` types that mirror the dataset shape. The validator is ported
alongside the engine and covered by the same vectors.

The `null`-vs-`0` distinction must be preserved in the Swift types: `Double?`,
`Int?`, `Bool?` — never a non-optional with a zero default. A single
`?? 0` in the decoder would silently undo the guarantee `src/validate.js` enforces.
Worth a lint rule or a code-review checklist item, because it is exactly the kind
of change that looks harmless in a diff.

---

## 12. Tariff-data delivery strategy

### 12.1 Recommendation: bundled snapshot + conditional fetch from the existing Pages deployment

The repository already deploys `data/` to GitHub Pages. That is a versioned,
static, CDN-backed, free, already-operating distribution channel, produced by a
reviewed pipeline. The app should use it, and nothing more should be built.

```
App bundle ships data/tariffs-<date>.json as of build time
            │
            ▼
On launch and on background refresh:
  GET https://martybo.github.io/Energy-Comparison-NI/data/latest.json
        (If-None-Match)
            │
    ┌───────┴────────┐
  304              200 + pointer
    │                │
  use cache     GET data/<file>, validate, compare effective_from,
                adopt if newer, cache; otherwise keep what we have
```

Selection rule: **use whichever of {bundled, cached, fetched} is valid and has
the latest `effective_from`.** Never assume the network copy is newer; a rollback
on the server must not be overridden by a stale cache, and a fresh install must
not be worse than an old one.

### 12.2 Why not the alternatives

| Approach | Why not |
|---|---|
| Bundle only, ship data in app updates | Couples data to App Review — days of latency on a monthly dataset, and users on old versions get stale rates indefinitely. Directly contradicts the decoupling requirement. |
| Fetch only, nothing bundled | First launch requires network; the app is useless offline on day one; a hosting outage bricks it. |
| Bespoke API | Operational cost, for strictly less reliability than a static CDN. |
| Scrape Consumer Council pages | **Explicitly forbidden**, and rightly: the repository's discovery layer already fails loudly on unexpected page structure, and an app cannot. |

The bundled snapshot is what makes the app **independent of the project's own
infrastructure**. If GitHub Pages vanished, the app would still work, with a
staleness banner — the behaviour `src/format.js` already implements.

### 12.3 Forward compatibility — the rule that matters most

The dataset header carries `schema_version` (currently `2`). The app must:

- **Refuse** a `schema_version` it does not understand, keep its current data, and
  tell the user an app update is available. Attempting to parse an unknown schema
  is how a future field change turns into a wrong number on someone's screen.
- **Tolerate unknown fields** within a known schema version, so additive dataset
  changes do not require an app release.

That pair — strict on version, lenient on fields — is the whole forward-compatibility
strategy, and it needs to be settled before the first release because it cannot be
retrofitted into versions already installed.

### 12.4 Integrity

HTTPS with App Transport Security is the practical baseline, and the threat model
is narrow: the content is public, non-financial and already served to browsers on
the same origin.

Detached signing (sign `latest.json` in the publish workflow; ship the public key
in the app) is feasible and would defend against a compromised Pages deployment.
It also introduces key management and a rotation story to a one-person project.
**Recommendation: defer, and record the decision.** This is a judgement about
proportionality, not a claim that the risk is zero; if the pipeline ever gains
automated dataset PRs (#17), the calculus changes, because the trusted path
lengthens.

Two integrity measures that are *not* deferred, because they are free: run the
ported validator over every downloaded dataset before adopting it, and reject a
dataset whose `effective_from` is in the future or implausibly old.

### 12.5 Standard-tariff dataset

`data/latest-standard.json` is optional by design and the web app handles its
absence by simply not rendering the comparison. iOS must mirror that behaviour
exactly: absent is an ordinary state, not an error, and produces no banner.

---

## 13. Versioning and provenance

### 13.1 What the app records per dataset

| Field | Source |
|---|---|
| `schema_version` | Dataset header |
| `effective_from`, `published` | Dataset header |
| `source`, `source_url`, `source_pdf_url` | Dataset header |
| `vat_treatment` | Dataset header |
| `conditions_verified` (+ its stated meaning) | Dataset header |
| Dataset file name | Pointer file |
| `retrievedAt` | Device clock at download |
| Origin | `bundled` \| `downloaded` |
| ETag | Response header, for conditional GET |

A dataset's identity is `(file name, effective_from)`, which is already unique in
practice. A future explicit `dataset_id` or monotonic `version` in the header
would be tidier and is worth adding when the extraction pipeline (#17) starts
generating datasets — but it is not needed for this to work, and proposing a
dataset schema change is out of this exploration's scope.

### 13.2 "Why this result?"

Every personalised figure should be traceable from a single sheet:

- **Usage**: the figure, the window (dates), the quality tier, how many readings
  it rests on, which intervals were excluded and why
- **Contract**: the rates used, when recorded, from where
- **Dataset**: version, effective date, retrieved date, origin, source link
- **Engine**: the warnings it emitted, in plain language
- **Caveats**: VAT treatment, `conditions_verified`, staleness, the
  quarterly-cap limitation where a cap applied

This is not a debugging affordance. It is the mechanism by which a user can
*disbelieve* the app and check it — which, for a tool whose output is "consider
changing supplier", is the difference between advice and an assertion.

### 13.3 Knowing a newer dataset exists

The conditional GET answers this directly. The app should show the effective date
on the comparison screen at all times (as the web app does), with the same
staleness thresholds (>35 days warn, >60 days error), computed by the ported
`datasetStatus()` so both platforms warn identically.

---

## 14. Privacy and security

### 14.1 Principles

1. **Local by default.** Personal data is written to the device store and nowhere
   else.
2. **No account, ever, for core function.** There is no sign-in, no email, no
   identifier.
3. **No personal data in any network request.** The only requests are anonymous
   GETs of public static files. No headers, query parameters or bodies carry
   anything derived from the user's data.
4. **Cloud is opt-in, explained, and reversible.** Enabling iCloud must state
   exactly what leaves the device and to whose account.
5. **Export and delete are first-class.** Both reachable in two taps; delete
   actually deletes.
6. **No advertising, no sale of data, no profiling.** Not as a policy stance —
   there is no mechanism by which it could occur, because the data never leaves.

### 14.2 Analytics

**Recommendation: none. No third-party SDK, no bespoke telemetry.**

The honest counter-argument is that without analytics the developer cannot know
whether CSV import succeeds, whether background refresh fires, or whether anyone
reaches the opportunity screen — and [§18](#18-risks-and-unresolved-decisions)
names several questions that would be answered faster with data.

It is still the wrong trade here. Every third-party SDK is an opaque dependency in
an app whose entire proposition is that nothing leaves the device, in a repository
that today has *zero* runtime dependencies. And the App Store privacy label would
have to change from "no data collected" to something requiring explanation.

Two adequate substitutes: Apple's own App Store metrics (crashes, aggregate
engagement, no SDK, nothing device-identifying), and an **in-app diagnostics
screen** the user can read — last refresh time, refresh success count, last import
result, dataset version. That turns telemetry into something the user can *see and
report*, rather than something taken from them. If a specific question later
genuinely needs aggregate data, that is a separate, explicit, opt-in decision with
its own review.

### 14.3 Security posture

- Data protection at the platform default ([§8.4](#84-encryption-at-rest))
- No secrets to store, so no Keychain use
- No authentication, so no credentials to leak
- Evidence images (bill photos) are the most sensitive artefact: stored locally,
  not synced initially, deleted with their contract, and never attached to a
  share/export unless the user explicitly includes them
- Export writes to a temporary file routed through the system share sheet; the
  user chooses the destination

### 14.4 App Store privacy disclosure

In the recommended architecture the app collects nothing, and the privacy label
should say so. Enabling iCloud sync does not change this: data goes to the *user's
own* iCloud account, not to the developer. That distinction should be stated
plainly in the app's own privacy text as well as the label, because "syncs to
iCloud" is easily misread as "sends to the developer".

---

## 15. Architecture options comparison

Rated **Strong / Adequate / Weak** rather than scored, because a weighted numeric
score here would imply a precision the analysis does not have.

| Criterion | **A. Local-only** | **B. Local-first + optional CloudKit** | **C. Local + hosted service/account** |
|---|---|---|---|
| Privacy | **Strong** — nothing leaves the device | **Strong** — user's own iCloud only; opt-in | **Weak** — personal data on third-party infrastructure |
| Simplicity | **Strong** | Adequate — one framework boundary | **Weak** — server, auth, API, migrations, monitoring |
| Development effort | **Strong** (lowest) | Adequate (+ sync work, mostly schema discipline) | **Weak** (multiplies the project) |
| Running cost | Apple Developer Program only (~£79–99/yr) | Same; CloudKit uses the *user's* quota | Same **plus** hosting, domain, backups, indefinitely |
| Offline capability | **Strong** | **Strong** | Adequate — degraded without network |
| Reliability | **Strong** — no external dependency | Adequate — sync can fail, app cannot | **Weak** — an outage is the user's outage |
| Backup / recovery | **Weak** — CSV export only; delete the app, lose the data | **Strong** — sync + export | **Strong** — server-side |
| Multi-device | **Weak** — none | **Strong** | **Strong** |
| Notifications | **Strong** — local, on-device, no server (§10) | **Strong** — same | Adequate — push adds latency benefit at large cost |
| Long-term maintenance | **Strong** | Adequate — CloudKit schema is additive-only and effectively permanent | **Weak** — security patching, cert rotation, data-protection obligations, forever |
| One-person suitability | **Strong** | **Strong** | **Weak** |
| Data-protection/legal exposure | None | None (no controller relationship) | **Real** — holding household data creates obligations |

**Option A** is genuinely viable and should not be dismissed. It delivers the
entire product, including notifications. Its single weakness is recovery, and
CSV export largely covers that. If effort were the binding constraint, A would be
the answer.

**Option C** fails on almost every criterion that matters to this project. The
notification requirement — the usual reason a project like this reaches for a
backend — is fully met without one. Building a server *anyway* would mean
accepting permanent cost, permanent maintenance, and a data-protection
relationship with the user's household data, in exchange for latency nobody needs.
**Rejected.**

**Option B** is A plus one optional capability, on the same code and the same
local store.

---

## 16. Recommended architecture

**Option B: local-first native SwiftUI app with optional, late, off-by-default
iCloud sync — and no backend.**

```
┌──────────────────────── iPhone ───────────────────────────┐
│                                                            │
│  SwiftUI views                                             │
│        │                                                   │
│  ┌─────┴──────────────┐   ┌────────────────────────────┐   │
│  │ Personal store      │   │ Tariff engine (Swift port) │   │
│  │ (SwiftData)         │   │ conformance-tested against │   │
│  │  Meter              │   │ spec/calc-vectors.json     │   │
│  │  MeterReading       │──▶│  usage → costFor/compare   │   │
│  │  ContractedTariff   │   └──────────┬─────────────────┘   │
│  │  ImportBatch        │              │                     │
│  │  Opportunity        │   ┌──────────┴─────────────────┐   │
│  └─────────┬───────────┘   │ Tariff dataset cache       │   │
│            │               │ bundled + downloaded JSON  │   │
│   optional │               └──────────┬─────────────────┘   │
│            ▼                          │                     │
│      ☁ CloudKit private DB     BGAppRefreshTask             │
│        (user's own iCloud)     + local notifications        │
└────────────────────────────────────────┬───────────────────┘
                                          │ anonymous GET (public static JSON)
                                          ▼
              GitHub Pages: data/latest.json, data/tariffs-*.json
                                          ▲
                      version-controlled, reviewed data pipeline
                              (#14 / #15 / #16 / #17)
```

**Server components: none.** **Accounts: none.** **Personal data transmitted:
none.**

The five decisions that define it:

1. The engine is ported to Swift and pinned to the JS reference by generated,
   CI-enforced conformance vectors.
2. Personal data lives in a local SwiftData store designed to CloudKit's
   constraints from the first version, whether or not sync is enabled.
3. The contracted tariff is a value snapshot, projected into the engine's own
   tariff shape and priced by the identical code path.
4. Tariff data is bundled *and* fetched from the existing Pages deployment,
   newest-valid-wins, with strict `schema_version` refusal.
5. Notifications are local, computed on-device after a background refresh, gated
   on usage quality and on the engine's own uncertainty flags.

---

## 17. Recommended staged MVP

The sequence differs from the issue's suggestion in three places, each for a
stated reason.

### Phase 0 — Data contract and calculation specification *(repository work; no app)*

- `docs/CALCULATION-SPEC.md`: the engine's rules in prose (R1–R7)
- `scripts/calc-vectors/generate.mjs` → `spec/calc-vectors.json`
- A JS conformance test and a CI check that fails on an undeclared vector diff
- Decide and document the `schema_version` compatibility rule ([§12.3](#123-forward-compatibility--the-rule-that-matters-most))

*Why first:* it is the only phase that delivers value even if the app is never
built — it hardens the web engine against its own future changes. It is also the
only phase that becomes *harder* if deferred, because by then a Swift
implementation exists and the vectors would be written to match whichever
implementation happened to be consulted.

### Phase 1 — Native comparison app

Feature parity with the web app: both meter types, both usage modes,
payment-method filter, Year 1/ongoing, the E7-vs-24-hour verdict with its caveat,
staleness banner, provenance. Bundled dataset plus conditional fetch. Swift engine
passing every vector.

*Exit criterion:* every vector passes, and the app and website agree on the live
dataset for a spread of usage inputs.

### Phase 2 — Contracted tariff, personalised comparison, and the contract-end reminder

Record the contract (§5); price it via the projection; compare against the market
using **estimated** usage; show first-year/ongoing/effective savings. Ship the
contract-end local notification ([§10.6](#106-a-second-notification-worth-more-than-the-first)).

*Why here, before meter readings:* this delivers the app's core value —
"is my deal still good?" — on day one of use, with nothing to accumulate. Meter
readings improve the answer; they are not required to give one. It also
introduces notifications in their simplest possible form, proving the permission
flow before anything depends on background execution.

### Phase 3 — Meter ledger **with** CSV import/export

Meters and readings (§4); anomaly classification; derived consumption; history
views. **CSV import and export in the same phase.**

*Why together:* the ledger has a ~12-month value latency, and import is the only
thing that collapses it. Shipping the ledger without import means a year in which
the feature does nothing for anyone who already keeps records — the users most
likely to want it. Export in the same phase also delivers the backup capability
that [§9.4](#94-sync-backup-or-both) argues must precede sync.

### Phase 4 — Readings-derived usage

Window selection, quality tiers (§6.2), the "why this result?" sheet (§13.2),
personalised comparison driven by measured usage.

*Why separate from Phase 3:* the ledger is useful on its own (seeing your own
consumption), and separating them keeps the risky part — annualisation and its
caveats — in its own release with its own testing.

### Phase 5 — Opportunity detection and local notifications

`BGAppRefreshTask` registration; on-device evaluation; the suppression rules
(§10.4); `Opportunity` records and deduplication (§10.5); user-configurable
threshold; the diagnostics screen (§14.2).

*Why after Phase 4:* the suppression rules depend on usage quality tiers, which do
not exist until Phase 4.

### Phase 6 — Optional iCloud sync

Enable CloudKit on the schema that has by now been exercised through five
releases. Sync state UI; conflict and duplicate handling; Apple ID change
guidance; explicit opt-in copy.

*Why last:* it is the only irreversible decision in the sequence — Apple documents
CloudKit schemas as additive-only after production promotion. Promoting a model
that five releases of real use have validated is a materially different risk from
promoting a model designed on paper. And export, shipped in Phase 3, has already
covered the data-loss risk in the meantime.

### Deliberately deferred

See [§19](#19-explicitly-deferred-features). The most important deferral is
**push notifications and any backend**: not "later", but "only if
[§10.8](#108-if-local-refresh-proves-insufficient)'s trigger condition is
measured, and then as a separate decision".

---

## 18. Risks and unresolved decisions

### 18.1 Background refresh cadence — highest prototype priority

Apple documents that the system chooses when `BGAppRefreshTask` runs, weighing
usage patterns among other factors. A utility opened monthly is close to the
worst case for that heuristic, and no amount of reasoning settles what actually
happens.

**Prototype:** a minimal app that registers a refresh task, logs every
invocation, and runs on real devices with realistic (i.e. rare) usage for several
weeks. Measure median and 95th-percentile time between fires.

**Decision it informs:** if cadence is poor, the response is *not* automatically
a server. First reduce reliance on background execution — lean on launch-time
checks and a user-scheduled calendar reminder ([§10.3](#103-the-local-architecture)).
Only if that is inadequate does [§10.8](#108-if-local-refresh-proves-insufficient)'s
contingency become live.

### 18.2 SwiftData + CloudKit dependability

SwiftData is younger than Core Data and its CloudKit integration has a mixed
reputation in developer reports. The constraints are documented
([§9.2](#92-the-constraints-apple-documents)); dependability at this scale is not
something documentation can settle.

**Spike** before Phase 6: this exact schema, two devices, one account —
offline edits, conflicting edits, a fresh install, an Apple ID change. If it
proves unreliable, Option A (local + export) remains a complete product, which is
precisely why sync is sequenced last.

### 18.3 Is the public dataset sufficient to represent real contracts?

The Consumer Council tables cover publicly advertised tariffs. Real households sit
on legacy products, expired fixed deals, and terms not in the table. The app
handles this by letting the user type their own rates — but the *comparison* is
only as good as the market data, and `conditions_verified` plus null eligibility
fields mean a "better" tariff may not be available to them.

Partly a product-copy problem ("worth checking", never "switch now"), partly a
data question that #17's extraction work may improve. **Unresolved.**

### 18.4 Register labelling and user error

NI Economy 7 meters are inconsistently labelled ([§4.7](#47-register-labelling--an-unresolved-real-world-problem)).
Transposed day/night registers produce confidently wrong output. Mitigations are
proposed; none is verified. **Needs real-meter research** — photographs of actual
NI installations, ideally — before Phase 3.

### 18.5 Thresholds and boundaries are unvalidated guesses

The £50 default saving, the 90/350-day tier boundaries, the 2× multiplier for
`partial` estimates, the 25% re-notify improvement, the 90-day dismissal, the
one-per-week cap. Every one is a judgement. They are gathered here so they can be
revisited as a set once there is real usage, rather than defended individually as
though they were derived.

### 18.6 Effort

Rough order of magnitude for a single part-time developer, offered as a planning
aid and not as an estimate: Phase 0 is days; Phases 1–2 are the bulk of the work;
Phases 3–5 are each a few weekends of coding and rather more of testing; Phase 6
is small in code and large in verification. The realistic risk is not any single
phase but **sustained maintenance**: an app must be rebuilt for each new Xcode and
iOS release, whereas the current static website will still work untouched in five
years. That asymmetry should be weighed before Phase 1 starts, because it is the
project's largest long-term commitment.

### 18.7 Apple Developer Program cost

An ongoing annual membership (~£79–99) is required to distribute on the App Store
*and* to use the iCloud capability at all. It applies to **all three** options —
it is not a cost that Option A avoids — and it is the project's only unavoidable
recurring expense in the recommended architecture.

### 18.8 Not yet decided

- Deployment target at implementation time (iOS 17 floor is from SwiftData; the
  current landscape is iOS 26, with iOS 27 released 14 September 2026)
- iPad and Mac Catalyst support — likely near-free with SwiftUI, unconfirmed
- Whether a Home Screen widget or App Intents/Siri shortcut for reading entry
  earns its complexity (App Intents is available from iOS 16; "add a meter
  reading" is a plausible fit, but it is polish)
- Open-sourcing the iOS app alongside the web app, which the repository's
  transparency posture would suggest
- Whether to add an explicit `dataset_id`/`version` to future dataset headers
  ([§13.1](#131-what-the-app-records-per-dataset))

---

## 19. Explicitly deferred features

Not rejected — deliberately out of scope, with the reason recorded so the
decision does not have to be relitigated.

| Deferred | Why |
|---|---|
| **Push notifications / any backend** | Local notifications meet the requirement (§10). Revisit only against §10.8's measured trigger. |
| **User accounts** | Nothing requires identity. |
| **Smart-meter / supplier API integration** | No general NI consumer API; would change the privacy model entirely. |
| **IoT / energy management** | Different product. |
| **Third-party analytics** | §14.2. |
| **Advertising, data sale** | Incompatible with the privacy model. |
| **Direct `.xlsx` / `.numbers` import** | Both export CSV (§7.2). |
| **Gas, oil, water** | NI domestic heating oil in particular has entirely different economics. |
| **Multiple properties / landlord mode** | Multiplies the model for a small audience; the `Meter` entity leaves the door open. |
| **Seasonal normalisation of short histories** | Would diverge from the web engine (§6.3). Only ever as a shared, specified, vector-covered change. |
| **Quarterly discount-cap modelling** | Genuinely enabled by a meter ledger, but must be a shared engine change, not an iOS refinement (§6.4). |
| **Automatic switching / broker integration** | Regulatory and commercial complexity; conflicts with independence. |
| **Bill photo OCR** | Interesting, unreliable, and on-device OCR of a bill is a large feature for a small saving in typing. |
| **Android** | The whole calculation-sharing question again, with a third implementation. The conformance-vector approach would extend to it — which is a further argument for §11.3. |
| **Widgets, App Intents, Apple Watch** | Polish. Reconsider after Phase 5. |
| **In-app passcode / Face ID lock** | Platform data protection is adequate (§8.4); revisit if users ask. |
| **Detached signing of the tariff dataset** | §12.4 — proportionality judgement, recorded rather than forgotten. |

---

## References

Apple developer documentation consulted directly for this exploration
(September 2026):

- [Syncing model data across a person's devices](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices) — SwiftData/CloudKit capabilities, unsupported unique constraints, optional relationships, additive-only schemas
- [Mirroring a Core Data store with CloudKit](https://developer.apple.com/documentation/coredata/mirroring-a-core-data-store-with-cloudkit) — private-database record zone, account requirements, CloudKit model limitations
- [Choosing background strategies for your app](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app) — "the system decides the best time"; up to 30 seconds of runtime; background-push rate limiting
- [BGAppRefreshTask](https://developer.apple.com/documentation/backgroundtasks/bgapprefreshtask) — the `fetch` capability requirement
- [BGTaskScheduler](https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler)
- [Scheduling a notification locally from your app](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app) — local notification triggers and delivery
- [Setting up a remote notification server](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server) — provider server requirement for push
- [Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns) — best-effort delivery, throttling, storage
- [Encrypting your app's files](https://developer.apple.com/documentation/uikit/encrypting-your-app-s-files) — data protection levels and the default
- [Keychain services](https://developer.apple.com/documentation/security/keychain-services) — intended for small secrets
- [UTType.commaSeparatedText](https://developer.apple.com/documentation/uniformtypeidentifiers/uttype-swift.struct/commaseparatedtext) — `public.comma-separated-values-text`
- [SwiftData](https://developer.apple.com/documentation/swiftdata) — availability from iOS 17.0
- [App Intents](https://developer.apple.com/documentation/appintents) — availability from iOS 16.0

Platform-version context (iOS 26 current, iOS 27 released 14 September 2026) and
the state of background-execution APIs for Home Screen web apps on iOS come from
secondary sources; the latter is corroborated by the absence of any corresponding
Apple API reference, and is flagged as such in [§2.2](#22-is-this-a-coherent-boundary-yes--but-the-reason-matters).

Repository material: `src/calc.js`, `src/validate.js`, `src/format.js`,
`test/fixtures.js`, `test/calc.test.js`, `test/deployment.test.js`,
`data/tariffs-2026-09-12.json`, `docs/DATA.md`, `docs/SOURCE-MONITORING.md`,
`README.md`, and issues #14–#18.
