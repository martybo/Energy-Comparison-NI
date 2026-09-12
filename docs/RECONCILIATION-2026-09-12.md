# Source-to-dataset reconciliation — 12 September 2026

Consumer Council for Northern Ireland, *Economy 7 Price Comparison Table*, prices for 12/09/2026 including VAT at 5%.

- Landing page: <https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/economy-7>
- PDF: <https://www.consumercouncil.org.uk/print/pdf/node/13469>

**The PDF is the sole authority for this dataset.** The previous repository JSON was not consulted: an earlier audit showed it was missing 12 of 49 rows of its own source and contained one payment-method combination that did not exist.

## Totals

| | Count |
|---|---:|
| Priced rows printed in the PDF | 31 |
| Tariff products in the dataset | 29 |
| — of which active | 27 |
| — of which withdrawn | 2 |
| Payment-method variants (rate rows) | 42 |
| Suppliers | 5 |

## By supplier

| Supplier | PDF rows | Products | Active | Withdrawn | Payment-method variants |
|---|---:|---:|---:|---:|---:|
| Budget Energy | 3 | 3 | 3 | 0 | 6 |
| Click Energy | 2 | 4 | 2 | 2 | 5 |
| Power NI | 7 | 7 | 7 | 0 | 7 |
| SSE Airtricity | 14 | 13 | 13 | 0 | 15 |
| Share Energy | 5 | 2 | 2 | 0 | 9 |

## Rows merged into one product

The PDF sometimes prints one product across several rows, or embeds the payment method in the tariff name. Each merge below collapses rows that differ only by payment method — never rows that represent genuinely different products.

- **SSE Airtricity — Smartsaver Standard - E7**: 2 PDF rows → 1 product with 2 payment methods.  
  PDF p8 prints this tariff on two rows (one shared with Keypad Standard Rate 24hr for "Pay on receipt of bill", one for "Pay on receipt of e-bill").

- **Share Energy — Share Eco 7**: 3 PDF rows → 1 product with 5 payment methods.  
  PDF p9 prints this as three rows whose names embed the payment method ("Share Eco 7 Keypad", "Share Eco 7- Pay on receipt of bill / or e-bill / -Direct debit e-bill", "Share Eco 7-Direct debit postal bill"). Merged into one product with five payment methods; the keypad standing charge differs.

- **Share Energy — Share EV**: 2 PDF rows → 1 product with 4 payment methods.  
  PDF p9-p10 prints this as two rows whose names embed the payment method. Merged into one product with four payment methods.

Products deliberately **not** merged despite identical rates:

- **Share Eco 7** and **Share EV** are separate products at the same price. The source names them distinctly, so they are kept distinct; the engine reports the tie rather than hiding one.
- **Keypad Standard Rate 24hr (E7)** and **Smartsaver Standard - E7** share a rate and a PDF row but are separately named prepayment and bill-pay products.

## Withdrawn products

- **Click Energy — Bill Pay Economy 7 Saver** — kept as a record with no rates. Withdrawn. The source states Click Energy removed all discounted tariffs, citing increased wholesale gas prices. No rates are published for it.
- **Click Energy — Keypad Economy 7 Saver** — kept as a record with no rates. Withdrawn. The source states Click Energy removed all discounted tariffs, citing increased wholesale gas prices. No rates are published for it.

Retaining them preserves the fact of withdrawal, which a reader comparing months would otherwise lose. The validator permits empty `rates` only for withdrawn records; the engine never prices them.

**Electric Ireland** appeared in the August 2025 table with four bill-pay tariffs and is absent from this one entirely. No record is created, because this dataset is built from this PDF alone and the PDF says nothing about them.

## Power NI threshold interpretation

The PDF states the rule twice, in two forms:

> discounts apply only up to £250 per quarter (£1,000 per year) — usage beyond this is charged at the standard rate

and, per tariff, *"Maximum of £60 savings per year"* (£46, £40, £26, £20 on the others).

These are the same rule: the stated maximum equals the tariff's discount applied to £1,000 of annual spend. 6% × £1,000 = £60, 4% × £1,000 = £40, 2% × £1,000 = £20.

It is modelled generically, with no supplier-specific arithmetic:

```
covered = threshold / standard_cost
total   = discounted_cost × covered + standard_cost × (1 − covered)
```

Working from the two cost figures rather than a percentage means any future tariff that names a threshold and a standard-rate reference is handled by the same code. `max_saving_gbp` is stored as the source's own cross-check and asserted in tests.

**Keypad is deliberately uncapped.** The PDF states PAYG customers *"are not affected by the £250 per quarter threshold"*, so `power-ni-keypad-e7` carries no `discount_cap`.

At the source's own typical usage of 3,200 kWh the cap does not bite for any Power NI tariff — a typical year costs under £1,000. It begins to bite at roughly 4,200 kWh.

## Source ambiguities and anomalies

- **SSE Airtricity — 1 Year Home Electricity 12% discount (E7)**: Start Date reads 01/08/2024 where every sibling tariff reads 01/08/2026; transcribed as printed.
- **Budget Energy — Budget Energy Keypad Promotional 1 Economy 7** advertises a *"Variable contract 16% discount"*, but 37.030p is not 16% below either Budget rate in the same table (it is 8.0% below the Keypad Economy 7 day rate and 13.7% below Bill Pay). The discount's baseline is therefore not determinable from the PDF: `headline_discount_pct` is recorded as display-only metadata and `reverts_to` is left null.
- **SSE Airtricity** headlines read *"up to X%"*. Every day rate derives exactly from the standard 41.590p (13% → 36.183 vs 36.180 published, and so on for all eight), but the night discount differs each time — 13% day is 9% night. `headline_discount_wording` is set to `up_to` so the figure is never presented as an exact discount on both rates.
- **Share Energy** carries a note that a tariff change is scheduled for 01 October 2026, so this dataset has a known expiry. Recorded in `supplier_notes`.

## Fields deliberately left null

`null` means the source does not state it. It is never a stand-in for zero.

| Field | Left null on | Why |
|---|---|---|
| `contract.exit_fee_gbp` | all Click Energy and all SSE *no contract* tariffs | Click no longer prints an exit-fee statement; SSE's *"No contract"* describes the contract type, not a fee. Only an explicit *"No exit fee"* is recorded as `0`. |
| `eligibility.new_customers_only` | Budget, Click, and SSE's standard tariffs | The source states availability for some tariffs and is silent for others. |
| `intro_period_months` | Budget's promotional tariff | A discount on a *variable* contract with no stated duration. Its ongoing cost is reported as unknown. |
| `reverts_to` | Budget's promotional tariff | Its discount baseline is not determinable (see above). |
| `contract.term_months` | Budget's two non-promotional tariffs | No contract statement. |

## What the PDF does not provide

- **A day/night usage split.** It states a typical annual consumption of 3,200 kWh but not how it divides between the rates. The application's 60% night default remains an unsourced assumption and is labelled as one on the page.
- **Reversion rates as an explicit statement.** SSE's 1-year tariffs are recorded as reverting to the standard rate. That is inferred from *"1 Year … fixed term discount … off standard unit rates"* plus the standard rate appearing in the same table, and is confirmed arithmetically: all eight discounted day rates derive exactly from 41.590p. The PDF does not say so in those words.
- **Whether discounts survive the introductory year** for Power NI and SSE's Smartsaver tariffs. Both are recorded as having no introductory period, which the source supports (*"No fixed term contract"*, *"No contract"*).
- **Any usage threshold other than Power NI's.** No other supplier states one.
- **VAT breakdown per line.** Only the footer statement that prices include VAT at 5%.

## Independent verification

Rankings produced by the engine were reproduced by a separate implementation written in Python with `Decimal` arithmetic, driven from the transcription rather than the shipped JSON. Both agree on every product. The test suite asserts the shipped dataset's date, VAT treatment, cheapest tariff, cap behaviour above and below the threshold, credit amounts (£30/£40/£60), exit-fee disclosure, and that withdrawn tariffs are never priced.

