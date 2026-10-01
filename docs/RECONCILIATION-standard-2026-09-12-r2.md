# Standard (24hr) reconciliation — source dated 2026-09-12

**No open gates.** Every payment slot the source printed is accounted for, and 2 recorded human decisions were applied where the source alone could not settle a row — see **Recorded decisions**. The candidate still requires human review before it is published.

## Source accounting

| | |
|---|---|
| Priced rows read | 35 |
| Payment-method slots printed | 46 |
| Rate rows mapped | 46 |
| Page-break repeats (counted once) | 1 |
| Extra rate rows from one printed slot shared by a recorded decision | 1 |
| Slots in rows awaiting a decision | 0 |
| Balanced | yes |
| Products (active / withdrawn) | 39 (35 / 4) |

## Dataset-level changes

- `notes`: Transcribed from the Consumer Council Electricity Price Comparison Table dated 12/09/2026, including its ADDITIONAL INFORMATION column. The source states its own annual-cost column does not factor in supplier incentives such as welcome credits; this dataset instead carries credits as structured adjustments so the calculation engine can apply them. Prices include VAT at 5% as stated by the source. The source states a typical annual consumption of 3,200 kWh but does not state a day/night split, which is not applicable to a single-rate tariff in any case. Fields the source does not state are null (unknown), never inferred. → Extracted automatically from the Consumer Council Electricity Price Comparison Table, including its ADDITIONAL INFORMATION column. The source states: "Prices for 12/09/2026 including VAT of 5%. Some tariffs may be available to new customers only. (Annual cost is calculated using a typical annual consumption of 3,200kWh and is based on unit rate and standing charge where applicable including VAT at 5%)" The source states its comparisons do not factor in supplier incentives such as welcome credit; this dataset carries the credits the source describes as structured adjustments so the calculation engine can apply them. Fields the source does not state are null (unknown), never inferred. Where a printed row could not be resolved from the source alone, a recorded human decision says how it was resolved (standard-sse-1-year-home-keypad-10-5-identity, standard-sse-24hr-standard-rate-row-grouping; scripts/extract/source-decisions.json).

## Products

1 added, 0 no longer present, 0 printed but awaiting a decision, 12 materially changed, 21 changed only in the transcribed source wording, 5 unchanged.

### Added

- `sse-airtricity-smartsaver-std-24hr` — SSE Airtricity, "SmartSaver Std 24hr" (active; on_receipt_postal)

### Changed

#### `budget-energy-bill-pay-29-discount` — Budget Energy, "Budget Energy Bill Pay 29% Discount"

- `notes`: 1 Year fixed term discount of 29% on Budget Energy's Standard Tariff. No Exit Fees. Available to new customers only. → 1 Year fixed term discount of 29% on Budget Energy’s Standard Tariff. No Exit Fees Available to new customers only.
- payment method added: `direct_debit_ebill`

#### `budget-energy-billpay-25-discount` — Budget Energy, "Billpay 25% Discount"

- `name`: Budget Billpay 25% Discount → Billpay 25% Discount

#### `budget-energy-keypad-loyalty-20-discount` — Budget Energy, "Keypad Loyalty 20% Discount"

- `name`: Budget Keypad Loyalty 20% Discount → Keypad Loyalty 20% Discount

#### `budget-energy-80-discount-keypad-20-discount` — Budget Energy, "Budget Energy £80 Discount and Keypad 20% Discount"

- `notes`: 1 Year fixed term discount of 20% on Budget standard unit rate. £80 free credit (£40 after switchover and £40 after month 9). 12 month contract with no exit fee. New customers only. → 1 Year fixed term discount of 20% on Budget standard unit rate. £80 free credit (£40 after switchover and £40 after month 9) 12 month contract with no exit fee. New customers only.
- `adjustments`: [{"type":"welcome_credit","amount_gbp":40,"applies":"first_year","timing":"unspecified"},{"type":"welcome_credit","amount_gbp":40,"applies":"first_year","timing":{"month":9}}] → [{"type":"fixed_credit","amount_gbp":80,"applies":"first_year","timing":"unspecified"}]

#### `budget-energy-100-loyalty-18-discount` — Budget Energy, "Budget Energy £100 Loyalty and 18% Discount"

- `notes`: Variable contract discount of 18% on Budget standard unit rate. £100 free credit (applied after your first quarterly bill has issued). No exit fee. → Variable contract discount of 18% on Budget standard unit rate. £100 free credit (applied after your first quarterly bill has issued.) No exit fee.
- `adjustments`: [{"type":"welcome_credit","amount_gbp":100,"applies":"first_year","timing":"unspecified"}] → [{"type":"fixed_credit","amount_gbp":100,"applies":"first_year","timing":"unspecified"}]

#### `budget-energy-keypad-60-loyalty-16-discount` — Budget Energy, "Budget Energy Keypad £60 Loyalty & 16% Discount"

- `notes`: Discount 16% & £60 Energy Credit. £30 after completion of switchover/renewal and £30 after 9 Months. No exit fee. → Discount 16% & £60 Energy Credit. £30 after completion of switchover/renewal and £30 after 9 Months No exit fee.
- `adjustments`: [{"type":"welcome_credit","amount_gbp":30,"applies":"first_year","timing":"unspecified"},{"type":"welcome_credit","amount_gbp":30,"applies":"first_year","timing":{"month":9}}] → [{"type":"fixed_credit","amount_gbp":60,"applies":"first_year","timing":"unspecified"}]

#### `budget-energy-keypad-standard-24hr` — Budget Energy, "Keypad Standard 24hr"

- `name`: Budget Keypad Standard 24hr → Keypad Standard 24hr

#### `budget-energy-bill-pay-standard-24hr` — Budget Energy, "Bill Pay - Standard 24hr"

- `name`: Budget Bill Pay - Standard 24hr → Bill Pay - Standard 24hr

#### `click-energy-bill-pay-24h` — Click Energy, "Bill Pay 24h"

- `name`: Click Bill Pay 24h → Bill Pay 24h

#### `click-energy-keypad-24h` — Click Energy, "Keypad 24h"

- `name`: Click Keypad 24h → Keypad 24h

#### `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr` — SSE Airtricity, "1 Year Home Keypad 10.5% discount plus £30 welcome credit (24hr)"

- `name`: 1 Year Keypad 10.5% discount plus £30 welcome credit (24hr) → 1 Year Home Keypad 10.5% discount plus £30 welcome credit (24hr)

#### `sse-airtricity-standard-rate-24hr` — SSE Airtricity, "Standard Rate 24hr"

- payment method no longer printed: `on_receipt_ebill`

### Wording-only changes

These records differ only in `notes`, the transcribed ADDITIONAL INFORMATION column. No rate, term, credit or eligibility field changed. The extraction reproduces the printed wording; the published text had been punctuated by hand.

<details><summary><code>power-ni-monthly-direct-debit-with-online-billing-standard</code> — Power NI, "Monthly Direct Debit with online billing"</summary>

- published: Equivalent to 6% off Standard Rate. Maximum of £60 savings per year. No fixed term contract. No exit fee. Available to new and existing customers.
- candidate: Equivalent to 6% off Standard Rate. Maximum of £60 savings per year No fixed term contract No exit fee Available to new and existing customers.

</details>
<details><summary><code>power-ni-quarterly-direct-debit-with-online-billing-standard</code> — Power NI, "Quarterly Direct Debit with online billing"</summary>

- published: Equivalent to 4.5% off Standard Rate. Maximum of £46 savings per year. No fixed term contract. No exit fee. Available to new and existing customers.
- candidate: Equivalent to 4.5% off Standard Rate. Maximum of £46 savings per year. No fixed term contract No exit fee Available to new and existing customers.

</details>
<details><summary><code>power-ni-monthly-direct-debit-standard</code> — Power NI, "Monthly Direct Debit"</summary>

- published: Equivalent to 4% off Standard Rate. Maximum of £40 savings per year. No fixed term contract. No exit fee. Available to new and existing customers.
- candidate: Equivalent to 4% off Standard Rate. Maximum of £40 savings per year No fixed term contract No exit fee Available to new and existing customers.

</details>
<details><summary><code>power-ni-keypad-standard</code> — Power NI, "Keypad"</summary>

- published: Equivalent to 2.5% off Standard Rate. Keypad reward: free electricity from £1-£4 for top ups between £50-£175 online or via app. No fixed term contract. No exit fee. Available to new and existing customers. The source states keypad customers are not affected by the quarterly discount threshold.
- candidate: Equivalent to 2.5% off Standard Rate. Keypad reward: free electricity from £1-£4 for top ups between £50-£175 online or via app. No fixed term contract No exit fee Available to new and existing customers.

</details>
<details><summary><code>power-ni-quarterly-direct-debit-standard</code> — Power NI, "Quarterly Direct Debit"</summary>

- published: Equivalent to 2.5% off Standard Rate. Maximum of £26 savings per year. No fixed term contract. No exit fee. Available to new and existing customers.
- candidate: Equivalent to 2.5% off Standard Rate. Maximum of £26 savings per year. No fixed term contract No exit fee Available to new and existing customers.

</details>
<details><summary><code>power-ni-standard-with-online-billing-standard</code> — Power NI, "Standard with online billing"</summary>

- published: Equivalent to 2% off Standard Rate for customers who activate an energy online account. Energy online account maximum savings of £20 per year. No fixed term contract. No exit fee. Available to new and existing customers.
- candidate: Equivalent to 2% off Standard Rate is available for customers who activate an energy online account. Energy online account maximum savings of £20 per year. No fixed term contract No exit fee Available to new and existing customers.

</details>
<details><summary><code>power-ni-standard-standard</code> — Power NI, "Standard"</summary>

- published: Standard rate. No fixed term contract. No exit fee. Available to new and existing customers.
- candidate: Standard rate. No fixed term contract No exit fee Available to new and existing customers.

</details>
<details><summary><code>sse-airtricity-1-year-home-electricity-15-discount-standard</code> — SSE Airtricity, "1 Year Home Electricity 15% discount"</summary>

- published: Get up to 15% off our standard electricity unit rates. Start Date: 01/08/2026. Contract Type: Bill pay, Fixed term. £40 early exit fee. Only available to new customers.
- candidate: Get up to 15% off our standard electricity unit rates Start Date: 01/08/2026 Contract Type: Bill pay, Fixed term £40 early exit fee Only available to new customers.

</details>
<details><summary><code>sse-airtricity-1-year-home-electricity-13-discount-standard</code> — SSE Airtricity, "1 Year Home Electricity 13% discount"</summary>

- published: Get up to 13% off our standard electricity unit rates. Start Date: 01/08/2026. Contract Type: Bill pay, Fixed term. £40 early exit fee. Only available to new customers.
- candidate: Get up to 13% off our standard electricity unit rates Start Date: 01/08/2026 Contract Type: Bill pay, Fixed term £40 early exit fee Only available to new customers.

</details>
<details><summary><code>sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard</code> — SSE Airtricity, "1 Year Home Electricity 10% discount plus £60 welcome credit"</summary>

- published: Get up to 10% off our standard electricity unit rates plus £60 welcome credit. Start Date: 01/08/2026. Contract Type: Bill pay, Fixed term. £40 early exit fee. Only available to new customers.
- candidate: Get up to 10% off our standard electricity unit rates plus £60 welcome credit Start Date: 01/08/2026 Contract Type: Bill pay, Fixed term £40 early exit fee Only available to new customers.

</details>
<details><summary><code>sse-airtricity-1-year-home-electricity-10-discount-standard</code> — SSE Airtricity, "1 Year Home Electricity 10% discount"</summary>

- published: Get up to 10% off our standard electricity unit rates. Start Date: 01/08/2026. Contract Type: Bill pay, Fixed term. £40 early exit fee. Only available to new customers.
- candidate: Get up to 10% off our standard electricity unit rates Start Date: 01/08/2026 Contract Type: Bill pay, Fixed term £40 early exit fee Only available to new customers.

</details>
<details><summary><code>sse-airtricity-1-year-home-electricity-9-discount-standard</code> — SSE Airtricity, "1 Year Home Electricity 9% discount"</summary>

- published: Get up to 9% off our standard electricity unit rates. Start Date: 01/08/2026. Contract Type: Bill pay, Fixed term. £40 early exit fee. Only available to new customers.
- candidate: Get up to 9% off our standard electricity unit rates Start Date: 01/08/2026 Contract Type: Bill pay, Fixed term £40 early exit fee Only available to new customers.

</details>
<details><summary><code>sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-standard</code> — SSE Airtricity, "1 Year Home Electricity 8% discount plus £60 welcome credit"</summary>

- published: Get up to 8% off our standard electricity unit rates plus £60 welcome credit (must be redeemed within one year, see T&C's). Fixed term. £40 early exit fee. Only available to new customers.
- candidate: Get up to 8% off our standard electricity unit rates plus £60 welcome credit (must be redeemed within one year, see T&C's) Fixed term £40 early exit fee Only available to new customers.

</details>
<details><summary><code>sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-standard</code> — SSE Airtricity, "1 Year Home Electricity 4% discount plus £60 welcome credit"</summary>

- published: Get up to 4% off our standard electricity unit rates plus £60 welcome credit (must be redeemed within one year, see T&C's). Fixed term. £40 early exit fee. Only available to new customers.
- candidate: Get up to 4% off our standard electricity unit rates plus £60 welcome credit (must be redeemed within one year, see T&C's) Fixed term £40 early exit fee Only available to new customers.

</details>
<details><summary><code>sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-standard</code> — SSE Airtricity, "1 Year Home Electricity 2% discount plus £60 welcome credit"</summary>

- published: Get up to 2% off our standard electricity unit rates plus £60 welcome credit (must be redeemed within one year, see T&C's). Fixed term. £40 early exit fee. Only available to new customers.
- candidate: Get up to 2% off our standard electricity unit rates plus £60 welcome credit (must be redeemed within one year, see T&C's) Fixed term £40 early exit fee Only available to new customers.

</details>
<details><summary><code>share-energy-share-24-credit</code> — Share Energy, "Share 24 Credit"</summary>

- published: No fixed term. No exit fee.
- candidate: No fixed term No exit fee.

</details>
<details><summary><code>share-energy-share-24-keypad</code> — Share Energy, "Share 24 Keypad"</summary>

- published: No fixed term. No exit fee.
- candidate: No fixed term No exit fee.

</details>
<details><summary><code>click-energy-bill-pay-round-the-clock</code> — Click Energy, "Bill Pay Round the Clock"</summary>

- published: Withdrawn. The source states Click Energy removed all of its discounted tariffs, citing increased wholesale gas prices.
- candidate: Click Energy tariff removal. Due to tensions in the middle east which has greatly increased wholesale gas prices (around 30% of electricity is generated from natural gas), Click Energy have taken the decision to remove all of their discounted tariffs: Bill Pay Round the Clock Keypad Round the Clock Bill Pay Twilight Keypad Twilight.

</details>
<details><summary><code>click-energy-keypad-round-the-clock</code> — Click Energy, "Keypad Round the Clock"</summary>

- published: Withdrawn. The source states Click Energy removed all of its discounted tariffs, citing increased wholesale gas prices.
- candidate: Click Energy tariff removal. Due to tensions in the middle east which has greatly increased wholesale gas prices (around 30% of electricity is generated from natural gas), Click Energy have taken the decision to remove all of their discounted tariffs: Bill Pay Round the Clock Keypad Round the Clock Bill Pay Twilight Keypad Twilight.

</details>
<details><summary><code>click-energy-bill-pay-twilight-std</code> — Click Energy, "Bill Pay Twilight"</summary>

- published: Withdrawn. The source states Click Energy removed all of its discounted tariffs, citing increased wholesale gas prices.
- candidate: Click Energy tariff removal. Due to tensions in the middle east which has greatly increased wholesale gas prices (around 30% of electricity is generated from natural gas), Click Energy have taken the decision to remove all of their discounted tariffs: Bill Pay Round the Clock Keypad Round the Clock Bill Pay Twilight Keypad Twilight.

</details>
<details><summary><code>click-energy-keypad-twilight-std</code> — Click Energy, "Keypad Twilight"</summary>

- published: Withdrawn. The source states Click Energy removed all of its discounted tariffs, citing increased wholesale gas prices.
- candidate: Click Energy tariff removal. Due to tensions in the middle east which has greatly increased wholesale gas prices (around 30% of electricity is generated from natural gas), Click Energy have taken the decision to remove all of their discounted tariffs: Bill Pay Round the Clock Keypad Round the Clock Bill Pay Twilight Keypad Twilight.

</details>

## Recorded decisions

Decisions a person has made about specific printed rows the source alone cannot resolve, from `scripts/extract/source-decisions.json`. Each applies only to the exact printed text it was made about.

- **applied** `standard-sse-1-year-home-keypad-10-5-identity` → `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr` (page 6, source row 20)
  - published name: "1 Year Keypad 10.5% discount plus £30 welcome credit (24hr)"
  - printed name: "1 Year Home Keypad 10.5% discount plus £30 welcome credit (24hr)"
  - decided by martybo (repository owner), 2026-10-01: Transcription correction: the printed row is the published product; its name is corrected to the source's wording and its id is kept.
- **applied** `standard-sse-24hr-standard-rate-row-grouping` (grouping; page 8, source row 31)
  - printed names: "SmartSaver Std 24hr", "Keypad Standard Rate 24hr", "Standard Rate 24hr"; printed methods: on_receipt_postal, prepayment
  - "SmartSaver Std 24hr" → `sse-airtricity-smartsaver-std-24hr`: on_receipt_postal
  - "Standard Rate 24hr" → `sse-airtricity-standard-rate-24hr`: on_receipt_postal
  - "Keypad Standard Rate 24hr" → `sse-airtricity-keypad-standard-rate-24hr`: prepayment
  - **source discrepancy recorded** for `sse-airtricity-keypad-standard-rate-24hr`: SSE Airtricity's own Keypad tariff sheet (KEYPAD-24H-E7-2.5, V10, prices quoted from 1 August 2026) states that all Keypad customers receive a continuous 2.5% discount off the SSE Airtricity standard rate, i.e. 39.77p per kWh inc. VAT, which the Council prints separately as 'Keypad Standard 24hr 2.5%'. The Council prints 40.79p for this tariff. Transcribed as the Council prints it: the Council is the source of record, and the supplier's statement is recorded here rather than used to override it.
  - decided by martybo (repository owner), 2026-10-01: Pay on receipt of bill at 40.79p is assigned to both 'SmartSaver Std 24hr' and 'Standard Rate 24hr', which this row represents at that rate; 'Keypad Standard Rate 24hr' takes Prepayment meter as the Council prints it, with SSE's contradicting statement recorded as a source discrepancy; the unprinted on_receipt_ebill slot is not carried. The separate question of what the 1-year Keypad tariffs revert to is not decided here.

## Carried-forward domain knowledge

Values the source does not state, taken from the previous dataset only where the product identity is unchanged.

| Product | Field | Value | From | Source contradicts |
|---|---|---|---|---|
| `budget-energy-bill-pay-29-discount` | `reverts_to` | budget-energy-bill-pay-standard-24hr | `budget-energy-bill-pay-29-discount` in data/tariffs-standard-2026-09-12.json | no |
| `budget-energy-80-discount-keypad-20-discount` | `reverts_to` | budget-energy-keypad-standard-24hr | `budget-energy-80-discount-keypad-20-discount` in data/tariffs-standard-2026-09-12.json | no |
| `power-ni-monthly-direct-debit-with-online-billing-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":60,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-monthly-direct-debit-with-online-billing-standard` in data/tariffs-standard-2026-09-12.json | no |
| `power-ni-monthly-direct-debit-with-online-billing-standard` | `product_grouping` | {"printed_cell":"Monthly Direct Debit with online billing","methods":["direct_debit_ebill"]} | `power-ni-monthly-direct-debit-with-online-billing-standard` in data/tariffs-standard-2026-09-12.json | no |
| `power-ni-quarterly-direct-debit-with-online-billing-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":46,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-quarterly-direct-debit-with-online-billing-standard` in data/tariffs-standard-2026-09-12.json | no |
| `power-ni-quarterly-direct-debit-with-online-billing-standard` | `product_grouping` | {"printed_cell":"Quarterly Direct Debit with online billing","methods":["direct_debit_ebill"]} | `power-ni-quarterly-direct-debit-with-online-billing-standard` in data/tariffs-standard-2026-09-12.json | no |
| `power-ni-monthly-direct-debit-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":40,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-monthly-direct-debit-standard` in data/tariffs-standard-2026-09-12.json | no |
| `power-ni-quarterly-direct-debit-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":26,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-quarterly-direct-debit-standard` in data/tariffs-standard-2026-09-12.json | no |
| `power-ni-standard-with-online-billing-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":20,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-standard-with-online-billing-standard` in data/tariffs-standard-2026-09-12.json | no |
| `power-ni-standard-with-online-billing-standard` | `product_grouping` | {"printed_cell":"Standard with online billing","methods":["direct_debit_ebill"]} | `power-ni-standard-with-online-billing-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-15-discount-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-15-discount-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-13-discount-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-13-discount-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr` | `reverts_to` | sse-airtricity-keypad-standard-rate-24hr | `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard` | `product_grouping` | {"printed_cell":"1 Year Home Electricity 10% discount plus £60 welcome credit","methods":["direct_debit_ebill"]} | `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-10-discount-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-10-discount-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-9-discount-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-9-discount-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12.json | no |
| `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12.json | no |
| `share-energy-share-24-credit` | `product_grouping` | {"printed_cell":"Share 24 Credit- Direct Debit e-bill Share 24 Credit- Direct debit postal bill","methods":["direct_debit_ebill","direct_debit_postal"]} | `share-energy-share-24-credit` in data/tariffs-standard-2026-09-12.json | no |
| `click-energy-bill-pay-round-the-clock` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-bill-pay-round-the-clock` in data/tariffs-standard-2026-09-12.json | no |
| `click-energy-keypad-round-the-clock` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-keypad-round-the-clock` in data/tariffs-standard-2026-09-12.json | no |
| `click-energy-bill-pay-twilight-std` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-bill-pay-twilight-std` in data/tariffs-standard-2026-09-12.json | no |
| `click-energy-keypad-twilight-std` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-keypad-twilight-std` in data/tariffs-standard-2026-09-12.json | no |

## Page-break repeats

- `sse-airtricity-keypad-standard-rate-24hr` `prepayment` reprinted on page 9; counted once.

