# Source state

One JSON record per tariff family (`economy7.json`, `standard.json`), written
by `scripts/source-monitor/check-source.mjs` only when the Consumer Council
source has actually changed. See
[`docs/SOURCE-MONITORING.md`](../../docs/SOURCE-MONITORING.md) for what these
files are, why they are version-controlled, and how they are used.

These files are monitoring provenance, not tariff data — they are never read
by the application (`index.html`, `src/`) and never affect the calculator.
