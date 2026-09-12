# Source-to-dataset reconciliation — 12 September 2026

Consumer Council for Northern Ireland, *Economy 7 Price Comparison Table*, prices for 12/09/2026 including VAT at 5%.

- Landing page: <https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/economy-7>
- PDF: <https://www.consumercouncil.org.uk/print/pdf/node/13469>

**The PDF is the sole authority for this dataset.** The previous repository JSON was not consulted: an earlier audit showed it was missing 12 of 49 rows of its own source and contained one payment-method combination that did not exist.

Counts below are derived from `docs/source-rows-2026-09-12.json`, a row-by-row trace of the PDF's priced table rows. Deriving them from an explicit row list rather than summing per-product figures is deliberate: an earlier draft of this document double-counted a row shared between two products and reported 31 rows instead of 30.

## Totals

| | Count |
|---|---:|
| Priced table rows in the PDF | 30 |
| Payment-method slots printed across those rows | 42 |
| Rate rows in the dataset | 42 |
| Tariff products | 29 |
| — active | 27 |
| — withdrawn | 2 |
| Suppliers | 5 |

**The integrity check that matters is the middle pair: 42 payment-method slots printed in the PDF, 42 rate rows in the dataset.** Every active product is reached by at least one row and no row points at a product that does not exist.

## Every priced row, traced

`Slots` is the number of payment methods printed in that row.

| # | Page | Slots | Dataset product(s) |
|---:|---:|---:|---|
| 1 | 2 | 1 | `budget-energy-keypad-promotional-1-economy-7` |
| 2 | 2 | 1 | `budget-energy-keypad-economy-7` |
| 3 | 2 | 4 | `budget-energy-bill-pay-economy-7` |
| 4 | 3 | 4 | `click-energy-bill-pay-economy-7` |
| 5 | 3 | 1 | `click-energy-keypad-economy-7` |
| 6 | 4 | 1 | `power-ni-monthly-direct-debit-with-online-billing-e7` |
| 7 | 4 | 1 | `power-ni-quarterly-direct-debit-with-online-billing-e7` |
| 8 | 4 | 1 | `power-ni-monthly-direct-debit-e7` |
| 9 | 4 | 1 | `power-ni-keypad-e7` |
| 10 | 4 | 1 | `power-ni-quarterly-direct-debit-e7` |
| 11 | 4 | 1 | `power-ni-standard-rate-with-online-billing-e7` |
| 12 | 5 | 1 | `power-ni-standard-rate-e7` |
| 13 | 6 | 1 | `sse-airtricity-1-year-home-electricity-13-discount` |
| 14 | 6 | 1 | `sse-airtricity-1-year-home-electricity-12-discount-e7` |
| 15 | 6 | 1 | `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-e7-meter` |
| 16 | 7 | 1 | `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-e7` |
| 17 | 7 | 2 | `sse-airtricity-1-year-home-electricity-9-discount-e7` |
| 18 | 7 | 1 | `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-e7` |
| 19 | 7 | 1 | `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-e7` |
| 20 | 7 | 1 | `sse-airtricity-smartsaver-standard-e7-4-discount` |
| 21 | 7 | 1 | `sse-airtricity-smartsaver-standard-e7-3-discount` |
| 22 | 7 | 1 | `sse-airtricity-keypad-standard-24hr-2-5-discount-e7` |
| 23 | 7 | 1 | `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-e7` |
| 24 | 8 | 2 | `sse-airtricity-keypad-standard-rate-24hr-e7`, `sse-airtricity-smartsaver-standard-e7` **← one row, two products** |
| 25 | 8 | 1 | `sse-airtricity-smartsaver-standard-e7` |
| 26 | 9 | 1 | `share-energy-share-eco-7` |
| 27 | 9 | 3 | `share-energy-share-eco-7` |
| 28 | 9 | 1 | `share-energy-share-eco-7` |
| 29 | 9 | 3 | `share-energy-share-ev` |
| 30 | 10 | 1 | `share-energy-share-ev` |

Row 24 is the only row feeding two products: PDF page 8 prints *Keypad Standard Rate 24hr (E7)* and *Smartsaver Standard - E7* stacked in one row at the same rates, with *Prepayment meter* and *Pay on receipt of bill* stacked in the method cell.

## By supplier

| Supplier | Priced rows | Products | Active | Withdrawn | Rate rows |
|---|---:|---:|---:|---:|---:|
| Budget Energy | 3 | 3 | 3 | 0 | 6 |
| Click Energy | 2 | 4 | 2 | 2 | 5 |
| Power NI | 7 | 7 | 7 | 0 | 7 |
| SSE Airtricity | 13 | 13 | 13 | 0 | 15 |
| Share Energy | 5 | 2 | 2 | 0 | 9 |

**Click Energy reads 2 rows → 4 products.** The *Priced rows* column counts priced table rows only. Click's two withdrawn products are not table rows at all: they come from a prose block on page 3 stating that Click has removed *Bill Pay Economy 7 Saver* and *Keypad Economy 7 Saver*. That block carries no rates, so both records have an empty `rates` array.

**SSE Airtricity reads 13 rows → 13 products → 15 rate rows.** Two products each carry two payment methods (the 9% discount, and Smartsaver Standard - E7), and one row feeds two products (row 24 above).

## Rows merged into one product

The PDF sometimes prints one product across several rows, or embeds the payment method in the tariff name. Each merge collapses rows differing only by payment method — never rows representing different products.

- **SSE Airtricity — Smartsaver Standard - E7** → 1 product with 2 payment methods.  
  PDF p8 prints this tariff on two rows (one shared with Keypad Standard Rate 24hr for "Pay on receipt of bill", one for "Pay on receipt of e-bill").

- **Share Energy — Share Eco 7** → 1 product with 5 payment methods.  
  PDF p9 prints this as three rows whose names embed the payment method ("Share Eco 7 Keypad", "Share Eco 7- Pay on receipt of bill / or e-bill / -Direct debit e-bill", "Share Eco 7-Direct debit postal bill"). Merged into one product with five payment methods; the keypad standing charge differs.

- **Share Energy — Share EV** → 1 product with 4 payment methods.  
  PDF p9-p10 prints this as two rows whose names embed the payment method. Merged into one product with four payment methods.

Products deliberately **not** merged despite identical rates:

- **Share Eco 7** and **Share EV** are separate products at the same price. The source names them distinctly, so they stay distinct; the engine reports the tie rather than hiding one.
- **Keypad Standard Rate 24hr (E7)** and **Smartsaver Standard - E7** share a rate and a row but are separately named prepayment and bill-pay products.

## Withdrawn products

- **Click Energy — Bill Pay Economy 7 Saver** — record retained, `rates: []`, sourced from the page-3 prose block rather than a priced row.
- **Click Energy — Keypad Economy 7 Saver** — record retained, `rates: []`, sourced from the page-3 prose block rather than a priced row.

Retaining them preserves the fact of withdrawal, which a reader comparing months would otherwise lose. The validator permits an empty `rates` array only for withdrawn records, and the engine never prices them.

**Electric Ireland** appeared in the August 2025 table with four bill-pay tariffs and is absent here entirely. No record is created: this dataset is built from this PDF alone, and the PDF says nothing about them.

## Power NI threshold: what the source says, and what is modelled

The PDF states the rule in two forms:

> discounts apply only up to £250 per quarter (£1,000 per year) — usage beyond this is charged at the standard rate

and, per tariff, a stated maximum annual saving.

### The two forms are not exactly equivalent

| Tariff | Headline | Headline × £1,000 | Source states | Agree? |
|---|---:|---:|---:|:--|
| Monthly Direct Debit with online billing (E7) | 6% | £60.00 | £60.00 | yes |
| Quarterly Direct Debit with online billing (E7) | 4.5% | £45.00 | £46.00 | **no** |
| Monthly Direct Debit (E7) | 4% | £40.00 | £40.00 | yes |
| Quarterly Direct Debit (E7) | 2.5% | £25.00 | £26.00 | **no** |
| Standard Rate with online billing (E7) | 2% | £20.00 | £20.00 | yes |

An earlier draft of this document claimed the two forms were the same rule, having checked only the three that agree. They differ by £1 on two tariffs. **The stated maximum is recorded for reference and is not used in the calculation** — changing `max_saving_gbp` to any value leaves every total unchanged. Only `threshold_gbp` drives the arithmetic.

### The modelled rule

```
covered = threshold_gbp / standard_cost
total   = discounted_cost × covered + standard_cost × (1 − covered)
```

Working from the two cost figures rather than a percentage means any future tariff naming a threshold and a standard-rate reference is handled by the same code, with no supplier-specific arithmetic.

### Known limitation: annual, not quarterly

> Power NI's source discount cap is stated both quarterly and annually. This calculator models the annual £1,000 threshold because it does not currently collect quarterly consumption. Results for strongly seasonal consumption may therefore differ from the supplier's actual annual bill.

The two readings agree only when spend is spread evenly across the year. Economy 7 is a storage-heating tariff, so this audience is often strongly seasonal. Measured at 4,000 kWh on *Monthly Direct Debit with online billing*:

| Quarterly spend profile | Quarterly rule | Annual model | Difference |
|---|---:|---:|---:|
| even (25/25/25/25) | £1081.95 | £1081.95 | — |
| seasonal (40/15/10/35) | £1094.01 | £1081.95 | £12.06 too low |
| winter-weighted (55/10/5/30) | £1100.53 | £1081.95 | £18.58 too low |

Manufacturing a quarterly split from an annual figure would substitute one assumption for another, so the limitation is documented rather than modelled. Collecting quarterly consumption is a later decision.

**Keypad is deliberately uncapped.** The PDF states PAYG customers *"are not affected by the £250 per quarter threshold"*, so `power-ni-keypad-e7` carries no `discount_cap`.

At the source's own typical usage of 3,200 kWh the cap does not bite for any Power NI tariff; it begins to bite at roughly 4,200 kWh.

## Source ambiguities and anomalies

- **SSE Airtricity — 1 Year Home Electricity 12% discount (E7)**: Start Date reads 01/08/2024 where every sibling tariff reads 01/08/2026; transcribed as printed.
- **Budget Energy — Budget Energy Keypad Promotional 1 Economy 7** advertises a *"Variable contract 16% discount"*, but 37.030p is not 16% below either Budget rate in the same table (8.0% below the Keypad Economy 7 day rate, 13.7% below Bill Pay). The baseline is not determinable from the PDF: `headline_discount_pct` is display-only metadata and `reverts_to` is null.
- **SSE Airtricity** headlines mostly read *"up to X%"*, and `headline_discount_wording` records which. Every discounted day rate derives exactly from the standard 41.590p, but the night discount differs each time — 13% day is 9% night. Three Smartsaver tariffs state an exact percentage rather than *"up to"*, and are marked `exact`.
- **Share Energy** carries a note that a tariff change is scheduled for 01 October 2026, so this dataset has a known expiry. Recorded in `supplier_notes`.

## `intro_period_months` and where its value comes from

A bare `0` previously meant two different things: *the source says there is no fixed term*, and *nobody found an incentive so we assumed there wasn't one*. That ambiguity is what let a 12-month introductory discount be recorded as a perpetual rate in the previous dataset. `intro_period_basis` now records the provenance.

| Basis | Records | Meaning |
|---|---:|---|
| `stated_no_fixed_term` | 15 | The source states "No fixed term contract" or "No contract". `intro_period_months: 0`. |
| `stated_fixed_term` | 8 | The source states a fixed term or a one-year discount. `intro_period_months: 12`. |
| `no_incentive_advertised` | 2 | The source states nothing about a term and advertises no discount or credit, so there is nothing that could expire. `intro_period_months: 0`. |
| `unstated` | 4 | The source advertises an incentive but states no duration, or says nothing at all. `intro_period_months: null` and ongoing cost is reported as unknown. |

The validator refuses `no_incentive_advertised` on any tariff that carries a headline discount, a welcome credit or a percentage discount, and refuses a non-null `intro_period_months` when the basis is `unstated`. The previous dataset's error is now structurally impossible rather than merely avoided.

This caught one record during the rebuild: **SSE Keypad Standard 24hr 2.5% discount** advertises a discount and the source states no duration, so it is `unstated` / `null` rather than an inferred `0`.

## Fields deliberately left null

`null` means the source does not state it. It is never a stand-in for zero.

| Field | Left null on | Why |
|---|---|---|
| `contract.exit_fee_gbp` | Click Energy, and SSE's *no contract* tariffs | Click no longer prints an exit-fee statement; SSE's *"No contract"* describes the contract type, not a fee. Only an explicit *"No exit fee"* is recorded as `0`. |
| `eligibility.new_customers_only` | Budget, Click, SSE's standard tariffs | The source states availability for some tariffs and is silent for others. |
| `intro_period_months` | Budget's promotional tariff, SSE Keypad 2.5% | Both advertise a discount with no stated duration. |
| `reverts_to` | Budget's promotional tariff | Its discount baseline is not determinable. |
| `contract.type` | Budget's two plain tariffs, SSE Keypad 2.5% | No contract statement. |

### What `conditions_verified: true` means

It means the source's ADDITIONAL INFORMATION column was transcribed for **every** record. It does **not** mean every condition is known. Fields the source leaves unstated remain `null` on the individual tariff, and the page shows *"Contract terms not stated by the supplier"* on those cards. The dataset-level flag and the per-record fields answer different questions.

## What the PDF does not provide

- **A day/night usage split.** It states a typical annual consumption of 3,200 kWh but not how it divides. The 60% night default is an unsourced assumption, labelled as one on the page.
- **Quarterly consumption**, which the Power NI cap would need to be modelled exactly.
- **Reversion rates as an explicit statement.** SSE's 1-year tariffs are recorded as reverting to the standard rate, inferred from *"1 Year … fixed term discount … off standard unit rates"* plus the standard rate appearing in the same table, and confirmed arithmetically: all eight discounted day rates derive exactly from 41.590p. The PDF does not say so in those words.
- **Any usage threshold other than Power NI's.** No other supplier states one.
- **A VAT breakdown per line.** Only the footer statement that prices include VAT at 5%.

## Independent verification

Every active product's Year 1 and ongoing cost was recomputed by a separate implementation written in Python with `Decimal` arithmetic, driven from the transcription rather than the shipped JSON, including cap adjustments and reversion lookups. **27 products, 0 mismatches, maximum difference £0.000000.** Ranking is monotonic in usage across 648 checks.

