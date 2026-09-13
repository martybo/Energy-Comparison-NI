# Source-to-dataset reconciliation — standard (24-hour) tariffs, 12 September 2026

Consumer Council for Northern Ireland, *Electricity Price Comparison Table*, prices for 12/09/2026 including VAT at 5%.

- Landing page: <https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/electricity-price-comparison-table>
- PDF: <https://www.consumercouncil.org.uk/print/pdf/node/13468>

**The PDF is the sole authority for this dataset**, exactly as for the Economy 7 dataset (see `RECONCILIATION-2026-09-12.md`). Counts below are derived from `docs/source-rows-standard-2026-09-12.json`, an explicit row-by-row trace.

**The source's own "ANNUAL COST" column is not used as ground truth.** Page 1 of the PDF states: *"Please note that our comparisons do not factor in the various supplier incentives such as welcome credit."* That column is a base unit-rate-and-standing-charge figure only. It was used solely as an independent arithmetic cross-check — every tariff transcribed below reproduces it exactly before any credit or cap is applied — and is never read into the dataset itself. Credits, discounts and caps are carried as structured `adjustments` so the calculation engine can apply them, which is the entire point of this project: the source's own headline figure does not do this.

## Totals

| | Count |
|---|---:|
| Priced table rows in the PDF | 35 |
| Payment-method slots printed across those rows | 45 |
| Rate rows in the dataset | 45 |
| Tariff products | 38 |
| — active | 34 |
| — withdrawn | 4 |
| Suppliers | 5 |

**45 payment-method slots printed in the PDF, 45 rate rows in the dataset.** Every active product is reached by at least one row and no row points at a product that does not exist (both asserted by test).

## By supplier

| Supplier | Priced rows | Products | Active | Withdrawn | Rate rows |
|---|---:|---:|---:|---:|---:|
| Budget Energy | 8 | 8 | 8 | 0 | 12 |
| Click Energy | 2 | 6 | 2 | 4 | 5 |
| Power NI | 7 | 7 | 7 | 0 | 7 |
| SSE Airtricity | 15 | 15 | 15 | 0 | 16 |
| Share Energy | 3 | 2 | 2 | 0 | 5 |

## Rows merged into one product

- **SSE Airtricity — Standard Rate 24hr** → 1 product with 2 payment methods.  
  PDF p8 stacks three tariff-name lines ('SmartSaver Std 24hr', 'Keypad Standard Rate 24hr', 'Standard Rate 24hr') over two payment-method lines ('Pay on receipt of bill', 'Prepayment meter') in a single row, all at the same rate. Resolved as two products, matching the equivalent ambiguous row in the Economy 7 dataset: Keypad Standard Rate 24hr (Prepayment) and Standard Rate 24hr (both pay-on-receipt methods, treating 'SmartSaver Std 24hr' as the same 0%-tier product under a second name rather than inventing a third distinct payment-method mapping the source text does not clearly support).

- **Share Energy — Share 24 Credit** → 1 product with 4 payment methods.  
  PDF p10 prints this as two rows whose names embed the payment method ('Share 24 Credit-Direct Debit e-bill' / 'Direct debit postal bill', 'Share 24 Credit-Pay on receipt of e-bill' / 'Pay on receipt of bill'). Merged into one product with four payment methods, matching how Share Eco 7 was handled in the Economy 7 dataset.

## Withdrawn products

- **Click Energy — Bill Pay Round the Clock** — record retained, `rates: []`, sourced from the page-3 prose block rather than a priced row.
- **Click Energy — Bill Pay Twilight** — record retained, `rates: []`, sourced from the page-3 prose block rather than a priced row.
- **Click Energy — Keypad Round the Clock** — record retained, `rates: []`, sourced from the page-3 prose block rather than a priced row.
- **Click Energy — Keypad Twilight** — record retained, `rates: []`, sourced from the page-3 prose block rather than a priced row.

A page-3 prose block states Click Energy has removed four discounted 24-hour tariffs (Bill Pay Round the Clock, Keypad Round the Clock, Bill Pay Twilight, Keypad Twilight), citing wholesale gas prices — the same withdrawal event recorded against Click's Economy 7 tariffs in the companion dataset, here affecting the standard-tariff side of their range.

## Power NI threshold cap

Identical mechanism and identical stated maximum savings (£60/£46/£40/£26/£20) to the Economy 7 dataset's Power NI tariffs — the same `discount_cap` adjustment type is reused with no engine change. Every discounted rate derives exactly from the standard rate (34.150p): 6% off → 32.101 vs published 32.100, 4.5% → 32.613 vs 32.610, 4% → 32.784 vs 32.780, 2.5% → 33.296 vs 33.290, 2% → 33.467 vs 33.460 (small rounding in the source's own published rate, not corrected here). Keypad is exempt from the cap, exactly as stated for the Economy 7 Power NI tariffs.

## SSE Airtricity reversion

Every discounted day rate derives exactly from the standard rate (40.790p): 15% → 34.672 vs published 34.670, 13% → 35.487 vs 35.490, 10.5% → 36.507 vs 36.510, and so on through every tier down to 1% → 40.382 vs 40.380 — confirming `reverts_to` for every fixed-term tariff arithmetically, the same method used for the Economy 7 dataset. All eleven fixed-term tariffs state Start Date 01/08/2026, a £40 early exit fee, and new-customers-only, matching the Economy 7 dataset's SSE tariffs exactly.

## Credit timing

Two Budget Energy tariffs split a welcome credit into two payments, one of which the source ties to a specific month:

- **£80 Discount and Keypad 20% Discount**: "£40 after switchover and £40 after month 9" → modelled as two `welcome_credit` adjustments, £40 with unspecified timing and £40 at month 9.
- **Keypad £60 Loyalty & 16% Discount**: "£30 after completion of switchover/renewal and £30 after 9 Months" → the same pattern, £30 unspecified plus £30 at month 9.
- **£100 Loyalty and 18% Discount**: "applied after your first quarterly bill has issued" — this depends on the customer's own billing cycle, not a fixed calendar month, so it is recorded with unspecified timing rather than an invented month number.

Three SSE tariffs (8%, 4%, 2% discount plus £60 credit) state their credit "must be redeemed within one year, see T&C's" — a redemption deadline, not an application date. Recorded verbatim in `notes`; it does not change the Year 1 arithmetic, since a welcome credit is already scoped to the first year in this model.

## Fields deliberately left null

| Field | Left null on | Why |
|---|---|---|
| `intro_period_months` | Budget's four variable-contract discount tariffs, SSE's Keypad Standard 24hr 2.5% | Each advertises a discount and states no duration — the same rule applied to the equivalent Economy 7 tariffs. |
| `contract.type` | Budget's £60 Loyalty tariff | No contract-type statement at all. |
| `contract.exit_fee_gbp` | SSE's variable-rate SmartSaver and Keypad 24hr tariffs | No exit-fee statement; only an explicit "No exit fee" is recorded as `0`. |
| `eligibility.new_customers_only` | Several Budget and all Power NI/Click/SSE variable tariffs | The source states availability for some tariffs and is silent for others. |

## What the PDF does not provide

- **Quarterly consumption**, which Power NI's cap is stated in terms of as well as annually — the same known limitation as the Economy 7 dataset's Power NI tariffs.
- **A reversion rate for Budget's variable-contract discounts** or for the two Budget tariffs with no contract-duration statement at all — their ongoing cost is reported as unknown rather than assumed to continue.
- **VAT breakdown per line.** Only the footer statement that prices include VAT at 5%.

## Independent verification

Every active product's Year 1 and ongoing cost was recomputed by a separate implementation written in Python with `Decimal` arithmetic, driven from the transcription rather than the shipped JSON, including cap adjustments and reversion lookups. **34 products, 0 mismatches, maximum difference £0.000000.**

