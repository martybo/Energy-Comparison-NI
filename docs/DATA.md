# Tariff data

The dataset is the foundation of this service. The application logic reads the
data structure and contains no supplier-specific or tariff-specific branching,
so **adding a supplier or a tariff is a data change only**. Two tests enforce
this: one prices an invented supplier, another fails if any real supplier or
tariff name appears in `src/calc.js`.

## Files

| File | Purpose |
|---|---|
| `data/latest.json` | Pointer naming the dataset currently served. |
| `data/tariffs-YYYY-MM-DD.json` | A dated snapshot, named for the source table's own effective date. Snapshots are kept, never overwritten. |

Publishing a new month means adding a dated file and changing one filename in
`data/latest.json`. No HTML or JavaScript changes.

## Dataset header

```json
"dataset": {
  "effective_from": "2026-09-12",
  "published":      "2026-09-12",
  "source":         "Consumer Council for Northern Ireland - domestic electricity price comparison",
  "source_url":     null,
  "vat_treatment":  "inclusive",
  "rate_unit":      "pence_per_kwh",
  "standing_unit":  "pence_per_day",
  "conditions_verified": false
}
```

`effective_from` drives the staleness banner: over 35 days shows a warning, over
60 days an error stating the data must not be used to choose a tariff. Stale
data is never allowed to pass as current.

`vat_treatment` must be `inclusive` or `exclusive`. Anything else produces a
warning and the footer tells the reader the totals may be understated, because a
comparison silently mixing the two would be wrong by 5%.

`conditions_verified: false` declares that contract terms, exit fees and
eligibility have not been checked against the supplier, and puts a notice on the
page saying so.

## Tariff record

One record per **tariff product**, with rates nested by payment method. Do not
create one record per payment method: that is what made the previous top ten
show four products across ten rows.

```json
{
  "id": "sse-airtricity-13-discount",
  "supplier": "SSE Airtricity",
  "name": "13% Discount",
  "meter_type": "economy7",
  "status": "active",
  "rate_basis": "discounted",
  "headline_discount_pct": 13,
  "intro_period_months": null,
  "reverts_to": null,
  "contract":    { "type": "unknown", "term_months": null, "exit_fee_gbp": null },
  "eligibility": { "new_customers_only": null, "notes": [] },
  "rates": [
    { "payment_method": "direct_debit_ebill",
      "day_p_per_kwh": 32.77, "night_p_per_kwh": 16.73, "standing_p_per_day": 10.22 }
  ],
  "adjustments": [
    { "type": "welcome_credit", "amount_gbp": 130, "applies": "first_year", "timing": "unspecified" }
  ],
  "notes": null
}
```

### `null` means unknown; `0` and `false` mean known-to-be-none

This distinction is enforced by the validator and matters throughout:

| Field | `null` | `0` / `false` |
|---|---|---|
| `intro_period_months` | duration not stated, so ongoing cost is unknowable | no introductory period; ongoing cost equals Year 1 |
| `contract.exit_fee_gbp` | not checked | confirmed no exit fee |
| `eligibility.new_customers_only` | not checked | confirmed open to everyone |

A rate of `0` is valid data. A rate that is absent, `null`, `NaN` or a numeric
string such as `"30.179"` is malformed and the record is rejected.

### `rate_basis` — the double-discount guard

| Value | Meaning |
|---|---|
| `standard` | Published rates are undiscounted. A `percentage_discount` adjustment will be calculated. |
| `discounted` | Published rates already include the advertised discount. |

A `percentage_discount` on a record marked `discounted` is a **validation
error**, not a silently skipped no-op, and the record is excluded. This makes
double-counting structurally impossible rather than merely avoided.

`headline_discount_pct` is a display label only and never enters any
calculation. Use it to show "13% discount" next to a rate that already includes
that discount.

### `payment_method`

One of `prepayment`, `direct_debit_ebill`, `direct_debit_postal`,
`on_receipt_ebill`, `on_receipt_postal`. Display labels live in the dataset's
`payment_methods` map, not in code.

Where several payment methods cost exactly the same, the engine reports the tie
rather than naming one: the choice would otherwise depend on the order of the
`rates` array, and naming one would imply the customer must switch to it.

**A payment method absent from `rates` means the tariff is genuinely not sold on
it.** If a method is missing because it was not captured from the source, say so
in `notes` or set `status: "incomplete"` — a transcription gap must never look
like a commercial fact.

### `adjustments`

Incentives are data. Never encode them in the tariff name: a name like
`"13% + £130 Credit"` cannot be calculated, and the credit was invisible to the
comparison for exactly that reason.

| `type` | Fields | Behaviour |
|---|---|---|
| `percentage_discount` | `pct`, `applies_to` (`all`/`day`/`night`) | Applied to unit rates. Requires `rate_basis: "standard"`. |
| `welcome_credit` | `amount_gbp`, `timing` | One-off. Subtracted from the Year 1 total. Never spread across months. |
| `fixed_credit` | `amount_gbp`, `timing` | As above. |
| `recurring_credit` | `amount_gbp`, `frequency` (`monthly`/`annual`) | Genuinely recurs, so it does spread across months. |
| `discount_cap` | `basis`, `threshold_gbp`, `standard_rate_ref`, `max_saving_gbp` | The discount applies only to the first `threshold_gbp` of annual spend at the standard rate; above it the standard rate is charged. |
| `fixed_charge` | `amount_gbp`, `frequency` (`once`/`annual`) | Added, not subtracted. |

`applies` is `first_year`, `ongoing` or `intro_period`. **Any other value is a
validation error**, not a default: an unrecognised scope would silently remove
the adjustment from every calculation, which is how a credit could go missing.

### Usage-threshold discount caps

Some suppliers discount only the first N pounds of annual spend. The rule is
expressed generically so no supplier needs its own code:

```
covered = threshold_gbp / standard_cost
total   = discounted_cost x covered + standard_cost x (1 - covered)
```

`standard_rate_ref` names the tariff whose rates are the undiscounted ones.
A reference that does not resolve is a **rejection**, not a warning: without it
the tariff would be priced too cheaply and could outrank genuinely cheaper
options. (A dangling `reverts_to` is only a warning, because Year 1 is still
priced correctly and the ongoing figure simply becomes unknown.)

`max_saving_gbp` records the cap the source states in its own words, and the
test suite asserts the computed saving never exceeds it.

`timing` on a one-off credit is either `"unspecified"` or `{ "month": 1 }`. A
credit with a stated month appears in that billing period alone. A credit with
unspecified timing counts in the Year 1 total and is reported as unplaced, so
nothing implies a supplier deducts one twelfth of it from each monthly bill.

**Exit fees are never added to cost.** They are only payable on early exit, so
they are disclosed as a condition.

## Year 1 and ongoing cost

```
Year 1 = energy + standing charges + applicable fixed charges − applicable credits
```

Ongoing cost is what the customer pays once any introductory deal ends:

| `intro_period_months` | Year 1 | Ongoing |
|---|---|---|
| `0` | published rates | same as Year 1 |
| `null` | published rates | **unknown** — reported as unknown, never assumed |
| `n` where `0 < n < 12` | `n` months at published rates + `12 − n` at the `reverts_to` rates | the `reverts_to` rates |
| `n >= 12` | published rates | the `reverts_to` rates, when known |

When an introductory period is declared but `reverts_to` is missing or
unresolvable, the engine flags the Year 1 figure as understated rather than
guessing a reversion rate.

All arithmetic runs at full precision; rounding happens only in `src/format.js`.
A displayed monthly average multiplied by twelve will not generally equal the
displayed Year 1 total. That is correct and must not be reconciled by adjusting
either figure.

## Monthly update runbook

1. Copy the newest `data/tariffs-YYYY-MM-DD.json` to the new snapshot's filename,
   dated to match the source table's own effective date.
2. Update the `dataset` header: `effective_from`, `published`, `source_url`, and
   `vat_treatment` once confirmed against the source.
3. Update rates. Keep each tariff's `id` stable so months can be compared; only
   mint a new id for a genuinely new product.
4. Mark tariffs no longer sold as `"status": "withdrawn"` rather than deleting
   them, so historical snapshots stay readable. A withdrawn record may have an
   empty `rates` array, since the source stops publishing rates for it; the
   engine never prices it.
5. Record incentives in `adjustments`, never in `name`.
6. Set `conditions_verified: true` only once contract terms, exit fees and
   eligibility have actually been checked against the supplier.
7. Point `data/latest.json` at the new file.
8. Run `npm test`. The suite validates the shipped dataset and fails on
   malformed records, duplicate ids and double-counted discounts.

## `intro_period_months` and `intro_period_basis`

A bare `0` used to mean two different things — *the source says there is no
fixed term* and *nobody found an incentive so we assumed there wasn't one*.
That ambiguity let a 12-month introductory discount be recorded as a perpetual
rate in an earlier dataset. `intro_period_basis` records where the value came
from:

| Basis | `intro_period_months` | Meaning |
|---|---|---|
| `stated_no_fixed_term` | `0` | The source says "No fixed term contract" or "No contract". |
| `stated_fixed_term` | the stated term | The source states a fixed term or a one-year discount. |
| `no_incentive_advertised` | `0` | The source says nothing about a term **and** advertises no discount or credit, so nothing can expire. |
| `unstated` | `null` | The source advertises an incentive but states no duration, or says nothing at all. Ongoing cost is reported as unknown. |

Two validator rules make the old error structurally impossible:

- `no_incentive_advertised` is **refused** on any tariff carrying a headline
  discount, a welcome credit or a percentage discount. If something is
  advertised, its duration must come from the source or the field must be null.
- `unstated` with a non-null `intro_period_months` is **refused**: an unstated
  duration cannot be an inferred number.

## What `conditions_verified` means

`conditions_verified: true` means the source's conditions column was
transcribed for **every** record. It does **not** mean every condition is
known. Fields the source leaves unstated stay `null` on the individual tariff,
and the page says so on those cards. The dataset flag and the per-record fields
answer different questions: *did we read the source* versus *did the source say*.

## Known limitation: quarterly discount thresholds

Power NI's discount cap is stated by the source both per quarter (£250) and per
year (£1,000). The calculator models the annual threshold, because it does not
collect quarterly consumption. Results for strongly seasonal consumption may
therefore differ from the supplier's actual annual bill — by roughly £12–£19 a
year at 4,000 kWh on a winter-weighted profile.

Manufacturing a quarterly split from an annual figure would replace one
assumption with another, so the limitation is documented rather than modelled.
Collecting quarterly consumption is a later decision, not an MVP requirement.

The stated maximum saving (`max_saving_gbp`) is recorded for reference and is
**not** used in the calculation; only `threshold_gbp` drives the arithmetic. The
two forms of the source's rule are not exactly equivalent — they differ by £1 on
two of the five capped tariffs — so neither is derived from the other.

## The current dataset

`data/tariffs-2026-09-12.json` is transcribed from the Consumer Council table
dated 12/09/2026, including its ADDITIONAL INFORMATION column. See
[`RECONCILIATION-2026-09-12.md`](RECONCILIATION-2026-09-12.md) for a row-by-row
trace from the PDF to the dataset, every merge, every field left null, and every
source ambiguity. `source-rows-2026-09-12.json` is the machine-readable row
trace the reconciliation is generated from.
