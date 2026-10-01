# Standard (24hr) reconciliation — source dated 2026-09-30

**No open gates.** Every payment slot the source printed is accounted for, and 1 recorded human decision was applied where the source alone could not settle a row — see **Recorded decisions**. The candidate still requires human review before it is published.

## Source accounting

| | |
|---|---|
| Priced rows read | 32 |
| Payment-method slots printed | 42 |
| Rate rows mapped | 43 |
| Page-break repeats (counted once) | 0 |
| Extra rate rows from one printed slot shared by a recorded decision | 1 |
| Slots in rows awaiting a decision | 0 |
| Balanced | yes |
| Products (active / withdrawn) | 37 (33 / 4) |

## Dataset-level changes

- `effective_from`: 2026-09-12 → 2026-09-30
- `published`: 2026-09-12 → 2026-09-30
- `notes`: Extracted automatically from the Consumer Council Electricity Price Comparison Table, including its ADDITIONAL INFORMATION column. The source states: "Prices for 12/09/2026 including VAT of 5%. Some tariffs may be available to new customers only. (Annual cost is calculated using a typical annual consumption of 3,200kWh and is based on unit rate and standing charge where applicable including VAT at 5%)" The source states its comparisons do not factor in supplier incentives such as welcome credit; this dataset carries the credits the source describes as structured adjustments so the calculation engine can apply them. Fields the source does not state are null (unknown), never inferred. Where a printed row could not be resolved from the source alone, a recorded human decision says how it was resolved (standard-sse-1-year-home-keypad-10-5-identity, standard-sse-24hr-standard-rate-row-grouping; scripts/extract/source-decisions.json). → Extracted automatically from the Consumer Council Electricity Price Comparison Table, including its ADDITIONAL INFORMATION column. The source states: "Prices for 30/09/2026 including VAT of 5%. Some tariffs may be available to new customers only. (Annual cost is calculated using a typical annual consumption of 3,200kWh and is based on unit rate and standing charge where applicable including VAT at 5%)" The source states its comparisons do not factor in supplier incentives such as welcome credit; this dataset carries the credits the source describes as structured adjustments so the calculation engine can apply them. Fields the source does not state are null (unknown), never inferred. Where a printed row could not be resolved from the source alone, a recorded human decision says how it was resolved (standard-sse-24hr-standard-rate-row-grouping; scripts/extract/source-decisions.json).

## Fields the published dataset did not carry

Part of the dataset contract (`src/contract.js`) but absent from the published dataset, so there is no earlier value to compare. They are not counted as product changes below. Each tariff value is derived from the printed source.

- `schema_version`: 2
- `payment_methods`: {"prepayment":"Prepayment","direct_debit_ebill":"Direct Debit (e-bill)","direct_debit_postal":"Direct Debit (postal bill)","on_receipt_ebill":"Pay on receipt of e-bill","on_receipt_postal":"Pay on receipt of bill"}
- `supplier_notes`: {"Click Energy":"The source states: \"Click Energy tariff removal: Due to tensions in the middle east which has greatly increased wholesale gas prices (around 30% of electricity is generated from natural gas), Click Energy have taken the decision to remove all of their discounted tariffs: Bill Pay Round the Clock Keypad Round the Clock Bill Pay Twilight Keypad Twilight\""}
- `headline_discount_wording` on 32 tariffs:
  - `exact` — 13: `budget-energy-billpay-25-discount`, `budget-energy-keypad-loyalty-20-discount`, `budget-energy-100-loyalty-18-discount`, `power-ni-monthly-direct-debit-with-online-billing-standard`, `power-ni-quarterly-direct-debit-with-online-billing-standard`, `power-ni-monthly-direct-debit-standard`, `power-ni-keypad-standard`, `power-ni-quarterly-direct-debit-standard`, `power-ni-standard-with-online-billing-standard`, `sse-airtricity-smartsaver-std-6-24hr`, `sse-airtricity-smartsaver-std-4-24hr`, `sse-airtricity-keypad-standard-24hr-2-5`, `sse-airtricity-smartsaver-std-1-24hr`
  - null (the source does not state it) — 10: `budget-energy-keypad-standard-24hr`, `budget-energy-bill-pay-standard-24hr`, `click-energy-bill-pay-24h`, `click-energy-keypad-24h`, `power-ni-standard-standard`, `sse-airtricity-smartsaver-std-24hr`, `sse-airtricity-standard-rate-24hr`, `sse-airtricity-keypad-standard-rate-24hr`, `share-energy-share-24-credit`, `share-energy-share-24-keypad`
  - `up_to` — 9: `sse-airtricity-1-year-home-electricity-15-discount-standard`, `sse-airtricity-1-year-home-electricity-13-discount-standard`, `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr`, `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard`, `sse-airtricity-1-year-home-electricity-10-discount-standard`, `sse-airtricity-1-year-home-electricity-9-discount-standard`, `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-standard`, `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-standard`, `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-standard`
- `start_date` on 32 tariffs:
  - null (the source does not state it) — 27: `budget-energy-billpay-25-discount`, `budget-energy-keypad-loyalty-20-discount`, `budget-energy-100-loyalty-18-discount`, `budget-energy-keypad-standard-24hr`, `budget-energy-bill-pay-standard-24hr`, `click-energy-bill-pay-24h`, `click-energy-keypad-24h`, `power-ni-monthly-direct-debit-with-online-billing-standard`, `power-ni-quarterly-direct-debit-with-online-billing-standard`, `power-ni-monthly-direct-debit-standard`, `power-ni-keypad-standard`, `power-ni-quarterly-direct-debit-standard`, `power-ni-standard-with-online-billing-standard`, `power-ni-standard-standard`, `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr`, `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-standard`, `sse-airtricity-smartsaver-std-6-24hr`, `sse-airtricity-smartsaver-std-4-24hr`, `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-standard`, `sse-airtricity-keypad-standard-24hr-2-5`, `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-standard`, `sse-airtricity-smartsaver-std-1-24hr`, `sse-airtricity-smartsaver-std-24hr`, `sse-airtricity-standard-rate-24hr`, `sse-airtricity-keypad-standard-rate-24hr`, `share-energy-share-24-credit`, `share-energy-share-24-keypad`
  - `2026-08-01` — 5: `sse-airtricity-1-year-home-electricity-15-discount-standard`, `sse-airtricity-1-year-home-electricity-13-discount-standard`, `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard`, `sse-airtricity-1-year-home-electricity-10-discount-standard`, `sse-airtricity-1-year-home-electricity-9-discount-standard`

## Products

1 added, 3 no longer present, 0 printed but awaiting a decision, 2 materially changed, 0 changed only in the transcribed source wording, 34 unchanged.

### Suspected renames (not acted on)

- `budget-energy-80-discount-keypad-20-discount` "Budget Energy £80 Discount and Keypad 20% Discount" → `budget-energy-keypad-60-loyalty-and-16-discount` "Budget Energy Keypad £60 Loyalty and 16% Discount"
  - Same supplier and the same set of payment methods. The printed name differs, so identity is not assumed: the candidate carries no domain knowledge from the previous product.

### Added

- `budget-energy-keypad-60-loyalty-and-16-discount` — Budget Energy, "Budget Energy Keypad £60 Loyalty and 16% Discount" (active; prepayment)

### No longer present

- `budget-energy-bill-pay-29-discount` — Budget Energy, "Budget Energy Bill Pay 29% Discount" (active; direct_debit_postal, direct_debit_ebill)
- `budget-energy-80-discount-keypad-20-discount` — Budget Energy, "Budget Energy £80 Discount and Keypad 20% Discount" (active; prepayment)
- `budget-energy-keypad-60-loyalty-16-discount` — Budget Energy, "Budget Energy Keypad £60 Loyalty & 16% Discount" (active; prepayment)

### Changed

#### `share-energy-share-24-credit` — Share Energy, "Share 24 Credit"

- `direct_debit_ebill` `unit_p_per_kwh`: 31.96 → 35.99
- `direct_debit_postal` `unit_p_per_kwh`: 31.96 → 35.99
- `on_receipt_ebill` `unit_p_per_kwh`: 31.96 → 35.99
- `on_receipt_postal` `unit_p_per_kwh`: 31.96 → 35.99

#### `share-energy-share-24-keypad` — Share Energy, "Share 24 Keypad"

- `prepayment` `unit_p_per_kwh`: 31.96 → 35.99

## Recorded decisions

Decisions a person has made about specific printed rows the source alone cannot resolve, from `scripts/extract/source-decisions.json`. Each applies only to the exact printed text it was made about.

- **applied** `standard-sse-24hr-standard-rate-row-grouping` (grouping; page 8, source row 29)
  - printed names: "SmartSaver Std 24hr", "Keypad Standard Rate 24hr", "Standard Rate 24hr"; printed methods: on_receipt_postal, prepayment
  - "SmartSaver Std 24hr" → `sse-airtricity-smartsaver-std-24hr`: on_receipt_postal
  - "Standard Rate 24hr" → `sse-airtricity-standard-rate-24hr`: on_receipt_postal
  - "Keypad Standard Rate 24hr" → `sse-airtricity-keypad-standard-rate-24hr`: prepayment
  - **source discrepancy recorded** for `sse-airtricity-keypad-standard-rate-24hr`: SSE Airtricity's own Keypad tariff sheet (KEYPAD-24H-E7-2.5, V10, prices quoted from 1 August 2026) states that all Keypad customers receive a continuous 2.5% discount off the SSE Airtricity standard rate, i.e. 39.77p per kWh inc. VAT, which the Council prints separately as 'Keypad Standard 24hr 2.5%'. The Council prints 40.79p for this tariff. Transcribed as the Council prints it: the Council is the source of record, and the supplier's statement is recorded here rather than used to override it.
  - decided by martybo (repository owner), 2026-10-01: Pay on receipt of bill at 40.79p is assigned to both 'SmartSaver Std 24hr' and 'Standard Rate 24hr', which this row represents at that rate; 'Keypad Standard Rate 24hr' takes Prepayment meter as the Council prints it, with SSE's contradicting statement recorded as a source discrepancy; the unprinted on_receipt_ebill slot is not carried. The separate question of what the 1-year Keypad tariffs revert to is not decided here.
- **no longer needed** `standard-sse-1-year-home-keypad-10-5-identity` — The previous dataset already records the printed name, so this decision is no longer needed and can be removed from the decisions file.

## Carried-forward domain knowledge

Values the source does not state, taken from the previous dataset only where the product identity is unchanged.

| Product | Field | Value | From | Source contradicts |
|---|---|---|---|---|
| `power-ni-monthly-direct-debit-with-online-billing-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":60,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-monthly-direct-debit-with-online-billing-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `power-ni-monthly-direct-debit-with-online-billing-standard` | `product_grouping` | {"printed_cell":"Monthly Direct Debit with online billing","methods":["direct_debit_ebill"]} | `power-ni-monthly-direct-debit-with-online-billing-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `power-ni-quarterly-direct-debit-with-online-billing-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":46,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-quarterly-direct-debit-with-online-billing-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `power-ni-quarterly-direct-debit-with-online-billing-standard` | `product_grouping` | {"printed_cell":"Quarterly Direct Debit with online billing","methods":["direct_debit_ebill"]} | `power-ni-quarterly-direct-debit-with-online-billing-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `power-ni-monthly-direct-debit-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":40,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-monthly-direct-debit-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `power-ni-quarterly-direct-debit-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":26,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-quarterly-direct-debit-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `power-ni-standard-with-online-billing-standard` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-standard","max_saving_gbp":20,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-standard-with-online-billing-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `power-ni-standard-with-online-billing-standard` | `product_grouping` | {"printed_cell":"Standard with online billing","methods":["direct_debit_ebill"]} | `power-ni-standard-with-online-billing-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-15-discount-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-15-discount-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-13-discount-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-13-discount-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr` | `reverts_to` | sse-airtricity-keypad-standard-rate-24hr | `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-24hr` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard` | `product_grouping` | {"printed_cell":"1 Year Home Electricity 10% discount plus £60 welcome credit","methods":["direct_debit_ebill"]} | `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-10-discount-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-10-discount-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-9-discount-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-9-discount-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-standard` | `reverts_to` | sse-airtricity-standard-rate-24hr | `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-standard` in data/tariffs-standard-2026-09-12-r2.json | no |
| `share-energy-share-24-credit` | `product_grouping` | {"printed_cell":"Share 24 Credit- Direct Debit e-bill Share 24 Credit- Direct debit postal bill","methods":["direct_debit_ebill","direct_debit_postal"]} | `share-energy-share-24-credit` in data/tariffs-standard-2026-09-12-r2.json | no |
| `click-energy-bill-pay-round-the-clock` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-bill-pay-round-the-clock` in data/tariffs-standard-2026-09-12-r2.json | no |
| `click-energy-keypad-round-the-clock` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-keypad-round-the-clock` in data/tariffs-standard-2026-09-12-r2.json | no |
| `click-energy-bill-pay-twilight-std` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-bill-pay-twilight-std` in data/tariffs-standard-2026-09-12-r2.json | no |
| `click-energy-keypad-twilight-std` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-keypad-twilight-std` in data/tariffs-standard-2026-09-12-r2.json | no |

