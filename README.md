# Energy-Comparison-NI

A browser-based tool for comparing Northern Ireland Economy 7 electricity
tariffs.

Conventional comparison calculators handle a single unit rate badly when
consumption is split between a day rate and a night rate. This tool estimates
what each tariff would actually cost for a given day/night usage pattern and
ranks on that, because **a lower unit rate is not the same as a cheaper bill**
once the standing charge and the usage split are taken into account.

The current dataset is a **dated snapshot** of the Consumer Council NI table
(see [Source](#source) below), not a live feed — tariffs are refreshed
periodically, not continuously. Once a snapshot ages past a few weeks the tool
displays a prominent on-page warning rather than presenting stale rates as
current, and this README does not claim otherwise.

## What it does

- Takes your usage either as an **estimate** (an annual total plus the share
  used at night) or as **your actual usage** (day-rate and night-rate kWh
  entered directly, exactly as they appear on an Economy 7 bill or meter —
  no percentage to work out yourself). Both feed the same calculation; there
  is no separate "actual usage" code path.
- Estimates the **Year 1** cost of every tariff: energy, standing charge,
  applicable charges, less any welcome credit.
- Shows the **ongoing** cost once an introductory deal ends — or says plainly
  that it is not known, rather than repeating the introductory price.
- Ranks cheapest first and shows the ten cheapest **distinct products**. Several
  tariffs from one supplier may appear; no supplier diversity quota is applied.
- Filters by payment method, optionally. Leaving it off is deliberate: switching
  how you pay can itself be the saving.
- When a standard (24-hour, single-rate) tariff dataset is also published, the
  page adds a second comparison and a plain verdict — **"Economy 7 looks
  cheaper for you"**, **"A 24-hour tariff looks cheaper for your usage"**, or
  **"The two options are very close"** within a small tolerance — so the
  question answered is not just "which Economy 7 tariff is cheapest" but "is
  Economy 7 still the right meter type for me at all". This is cost only: the
  page always says to check with the supplier that a meter/tariff switch is
  actually available before acting on it. Publishing the standard dataset is
  a data change; the comparison itself needs no code change to appear once
  `data/latest-standard.json` exists (see [`docs/DATA.md`](docs/DATA.md)).

## Live site

<https://martybo.github.io/Energy-Comparison-NI/>

Deployed automatically from `main` by GitHub Actions once its CI checks pass
— see [Continuous integration](#continuous-integration) below. (GitHub Pages
must be switched on once, under repository Settings → Pages → Source: GitHub
Actions, before this URL serves anything.)

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
be checked by hand. It also asserts that the files `index.html` fetches and
imports actually exist and that the dataset `data/latest.json` points at
validates — the specific way a static, no-build deployment can break silently.

## Continuous integration

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs the full test
suite above on every pull request and every push to `main`. There is nothing
else for it to run: no separate lint step, no build, no reimplementation of
the checks in YAML — it calls `npm test`, the same command you run locally.

Deployment (`.github/workflows/pages.yml`) reuses that same workflow as a gate,
so a red test suite can never reach the live site.

## Data refresh

Publishing a new month's tariffs is a data change, not a code change — see
[`docs/DATA.md`](docs/DATA.md) for the schema and the full runbook. In brief:
add a new dated `data/tariffs-YYYY-MM-DD.json`, point `data/latest.json` at it,
and generate a matching source reconciliation and row trace alongside it so
the new dataset's provenance is auditable the same way the current one is.

## Layout

| Path | Purpose |
|---|---|
| `index.html` | View and wiring. Contains no arithmetic. |
| `src/calc.js` | Cost and ranking engine. Pure functions, no DOM. |
| `src/validate.js` | Dataset validation. |
| `src/format.js` | Display formatting. The only place rounding happens. |
| `data/` | Tariff snapshots and the `latest.json` pointer. |
| `docs/DATA.md` | Schema reference and the monthly update runbook. |
| `test/` | `node --test` suite, including deployment safety checks. |
| `.github/workflows/` | CI and GitHub Pages deployment. |

The engine contains no supplier-specific or tariff-specific logic, so adding a
supplier or tariff is a data change only. See
[`docs/DATA.md`](docs/DATA.md) for the schema and how to publish a new month.

## Source

Tariff figures derive from Consumer Council for Northern Ireland price
comparison material. All figures produced by this tool are estimates, not
quotes.

## Design

The visual style (a restrained purple/lavender palette, plain-language
headings, and an accessibility-first approach to colour, focus and contrast)
takes inspiration from the Consumer Council for Northern Ireland's
public-facing consumer information design. This is an independent project:
it is not affiliated with, endorsed by, or produced by the Consumer Council,
and it does not use their logo, brand colours, or other identifying
material.

## Licence

[MIT](LICENSE).
