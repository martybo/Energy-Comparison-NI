// Temporary diagnostic (not for main): fetch both landing pages with the
// monitor's exact request and log status and identifying response headers.
import { TARIFF_FAMILIES } from './sources.mjs';
const H = {
  'User-Agent': 'EnergyComparisonNI-SourceMonitor/1.0 (+https://github.com/martybo/Energy-Comparison-NI)',
  Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8'
};
const label = process.argv[2] ?? '';
for (let round = 1; round <= 3; round++) {
  for (const f of TARIFF_FAMILIES) {
    const t = new Date().toISOString();
    try {
      const r = await fetch(f.landingPageUrl, { redirect: 'follow', headers: H });
      const pick = ['server', 'via', 'x-cache', 'cf-ray', 'cf-mitigated', 'x-iinfo', 'x-cdn', 'x-akamai-transformed', 'set-cookie', 'content-type', 'x-drupal-cache', 'age']
        .map((k) => [k, r.headers.get(k)]).filter(([, v]) => v).map(([k, v]) => `${k}=${String(v).slice(0, 80)}`).join(' | ');
      const body = await r.text();
      console.log(`[${label} node ${process.version}] round ${round} ${t} ${f.id}: HTTP ${r.status} final=${r.url} bytes=${body.length} :: ${pick}`);
      if (!r.ok) console.log(`   body: ${body.replace(/\s+/g, ' ').slice(0, 400)}`);
    } catch (e) {
      console.log(`[${label} node ${process.version}] round ${round} ${t} ${f.id}: ERROR ${e.message}`);
    }
  }
}
