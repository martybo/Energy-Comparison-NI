# Energy-Comparison-NI

A browser-based tool for comparing Northern Ireland Economy 7 electricity
tariffs.

Conventional comparison calculators handle a single unit rate badly when
consumption is split between a day rate and a night rate. This tool estimates
what each tariff would actually cost for a given day/night usage pattern and
ranks on that, because **a lower unit rate is not the same as a cheaper bill**
once the standing charge and the usage split are taken into account.

> ⚠️ The tariff data in this repository is a **August 2025 prototype snapshot and
> is out of date**. The tool displays a prominent warning to that effect. It is
> not yet suitable for choosing a tariff.

## What it does

- Takes your usage as either an annual total with a day/night split, or an
  average per day.
- Estimates the **Year 1** cost of every tariff: energy, standing charge,
  applicable charges, less any welcome credit.
- Shows the **ongoing** cost once an introductory deal ends — or says plainly
  that it is not known, rather than repeating the introductory price.
- Ranks cheapest first and shows the ten cheapest **distinct products**. Several
  tariffs from one supplier may appear; no supplier diversity quota is applied.
- Filters by payment method, optionally. Leaving it off is deliberate: switching
  how you pay can itself be the saving.

## Running it

It is a static site with no build step and no dependencies. Module scripts need
to be served over HTTP rather than opened from disk:

```sh
npm run serve     # or: python3 -m http.server 8000
```

then open <http://localhost:8000>.

## Tests

```sh
npm test          # node --test, no install required
```

The suite covers the cost model, the Year 1 incentive rules, ranking, filtering,
input handling and dataset validation, against deterministic fixtures that can
be checked by hand.

## Layout

| Path | Purpose |
|---|---|
| `index.html` | View and wiring. Contains no arithmetic. |
| `src/calc.js` | Cost and ranking engine. Pure functions, no DOM. |
| `src/validate.js` | Dataset validation. |
| `src/format.js` | Display formatting. The only place rounding happens. |
| `data/` | Tariff snapshots and the `latest.json` pointer. |
| `docs/DATA.md` | Schema reference and the monthly update runbook. |

The engine contains no supplier-specific or tariff-specific logic, so adding a
supplier or tariff is a data change only. See
[`docs/DATA.md`](docs/DATA.md) for the schema and how to publish a new month.

## Source

Tariff figures derive from Consumer Council for Northern Ireland price
comparison material. All figures produced by this tool are estimates, not
quotes.
