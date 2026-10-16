# Economy 7 reconciliation — source dated 2026-10-15

**No open gates.** Every payment slot the source printed is accounted for, and no value needed a human decision. The candidate still requires human review before it is published.

## Source accounting

| | |
|---|---|
| Priced rows read | 27 |
| Payment-method slots printed | 38 |
| Rate rows mapped | 38 |
| Page-break repeats (counted once) | 0 |
| Slots in rows awaiting a decision | 0 |
| Balanced | yes |
| Products (active / withdrawn) | 28 (26 / 2) |

## Dataset-level changes

- `effective_from`: 2026-09-30 → 2026-10-15
- `published`: 2026-09-30 → 2026-10-15
- `notes`: Extracted automatically from the Consumer Council Economy 7 Price Comparison Table, including its ADDITIONAL INFORMATION column. The source states: "Prices for 30/09/2026 including VAT of 5%. Some tariffs may be available to new customers only. (Annual cost is calculated using a typical annual consumption of 3,200kWh and is based on unit rate and standing charge where applicable including VAT at 5%)" Credits the source describes are carried as structured adjustments so the calculation engine can apply them. The source states a typical annual consumption of 3,200 kWh but does not state a day/night split. Fields the source does not state are null (unknown), never inferred. → Extracted automatically from the Consumer Council Economy 7 Price Comparison Table, including its ADDITIONAL INFORMATION column. The source states: "Prices for 15/10/2026 including VAT of 5%. Some tariffs may be available to new customers only. (Annual cost is calculated using a typical annual consumption of 3,200kWh and is based on unit rate and standing charge where applicable including VAT at 5%)" Credits the source describes are carried as structured adjustments so the calculation engine can apply them. The source states a typical annual consumption of 3,200 kWh but does not state a day/night split. Fields the source does not state are null (unknown), never inferred.

## Products

0 added, 1 no longer present, 0 printed but awaiting a decision, 0 materially changed, 0 changed only in the transcribed source wording, 28 unchanged.

### No longer present

- `share-energy-share-ev` — Share Energy, "Share EV" (active; on_receipt_postal)

## Carried-forward domain knowledge

Values the source does not state, taken from the previous dataset only where the product identity is unchanged.

| Product | Field | Value | From | Source contradicts |
|---|---|---|---|---|
| `power-ni-monthly-direct-debit-with-online-billing-e7` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-rate-e7","max_saving_gbp":60,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-monthly-direct-debit-with-online-billing-e7` in data/tariffs-2026-09-30.json | no |
| `power-ni-quarterly-direct-debit-with-online-billing-e7` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-rate-e7","max_saving_gbp":46,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-quarterly-direct-debit-with-online-billing-e7` in data/tariffs-2026-09-30.json | no |
| `power-ni-monthly-direct-debit-e7` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-rate-e7","max_saving_gbp":40,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-monthly-direct-debit-e7` in data/tariffs-2026-09-30.json | no |
| `power-ni-quarterly-direct-debit-e7` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-rate-e7","max_saving_gbp":26,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-quarterly-direct-debit-e7` in data/tariffs-2026-09-30.json | no |
| `power-ni-standard-rate-with-online-billing-e7` | `discount_cap` | {"type":"discount_cap","applies":"ongoing","basis":"annual_spend_at_standard_rate","threshold_gbp":1000,"standard_rate_ref":"power-ni-standard-rate-e7","max_saving_gbp":20,"source_wording":"Discounts apply only up to £250 per quarter (£1,000 per year); usage beyond this is charged at the standard rate.","modelling_note":"Modelled as the annual £1,000 threshold. The calculator does not collect quarterly consumption, so results for strongly seasonal usage may differ from the supplier's actual annual bill."} | `power-ni-standard-rate-with-online-billing-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-home-electricity-13-discount` | `reverts_to` | sse-airtricity-smartsaver-standard-e7 | `sse-airtricity-1-year-home-electricity-13-discount` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-home-electricity-12-discount-e7` | `reverts_to` | sse-airtricity-smartsaver-standard-e7 | `sse-airtricity-1-year-home-electricity-12-discount-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-e7-meter` | `reverts_to` | sse-airtricity-keypad-standard-rate-24hr-e7 | `sse-airtricity-1-year-keypad-10-5-discount-plus-30-welcome-credit-e7-meter` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-e7` | `reverts_to` | sse-airtricity-smartsaver-standard-e7 | `sse-airtricity-1-year-home-electricity-10-discount-plus-60-welcome-credit-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-home-electricity-9-discount-e7` | `reverts_to` | sse-airtricity-smartsaver-standard-e7 | `sse-airtricity-1-year-home-electricity-9-discount-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-home-electricity-9-discount-e7` | `product_grouping` | {"printed_cell":"1 Year Home Electricity 9% discount (E7) 1 Year Home Electricity 9% discount (E7)","methods":["on_receipt_postal","on_receipt_ebill"]} | `sse-airtricity-1-year-home-electricity-9-discount-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-e7` | `reverts_to` | sse-airtricity-smartsaver-standard-e7 | `sse-airtricity-1-year-home-electricity-8-discount-plus-60-welcome-credit-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-e7` | `reverts_to` | sse-airtricity-smartsaver-standard-e7 | `sse-airtricity-1-year-home-electricity-4-discount-plus-60-welcome-credit-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-e7` | `reverts_to` | sse-airtricity-smartsaver-standard-e7 | `sse-airtricity-1-year-home-electricity-2-discount-plus-60-welcome-credit-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-keypad-standard-rate-24hr-e7` | `product_grouping` | {"printed_cell":"Keypad Standard Rate 24hr (E7) Smartsaver Standard - E7","methods":["prepayment"]} | `sse-airtricity-keypad-standard-rate-24hr-e7` in data/tariffs-2026-09-30.json | no |
| `sse-airtricity-smartsaver-standard-e7` | `product_grouping` | {"printed_cell":"Keypad Standard Rate 24hr (E7) Smartsaver Standard - E7","methods":["on_receipt_postal"]} | `sse-airtricity-smartsaver-standard-e7` in data/tariffs-2026-09-30.json | no |
| `share-energy-share-eco-7` | `product_grouping` | {"printed_cell":"Share Eco 7 Keypad","methods":["prepayment"]} | `share-energy-share-eco-7` in data/tariffs-2026-09-30.json | no |
| `click-energy-bill-pay-economy-7-saver` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-bill-pay-economy-7-saver` in data/tariffs-2026-09-30.json | no |
| `click-energy-keypad-economy-7-saver` | `withdrawn_product_terms` | {"retained_from_status":"withdrawn"} | `click-energy-keypad-economy-7-saver` in data/tariffs-2026-09-30.json | no |

