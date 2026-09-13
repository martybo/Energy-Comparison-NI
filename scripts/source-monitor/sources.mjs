/**
 * Configuration for the tariff families this tool monitors.
 *
 * Each family names the Consumer Council landing page that is authoritative
 * for "what is the current PDF". Family disambiguation comes from fetching
 * each family's own dedicated landing page, not from matching a PDF link's
 * own text against the family name — see the note in discover.mjs.
 *
 * `pdfLinkPatterns` (at least one must match a candidate's link text or URL,
 * alongside a literal .pdf extension which is always accepted) and
 * `excludePatterns` (none may match) are deliberately conservative: a page
 * whose real structure does not fit this shape should fail discovery rather
 * than have the tool guess.
 *
 * Verified live 2026-09-13 (see issue #16): both pages render their current
 * table's PDF as a "View PDF" link to a Drupal print endpoint
 * (/print/pdf/node/<id>), not a URL ending in .pdf, present in the
 * server-rendered HTML (not injected by client-side JS). Neither page had
 * an archive/historical section of its own at the time of verification.
 */

export const ARCHIVE_HEADING_PATTERN = /archive|historical|previous|superseded|past\s+(table|price)/i;

export const TARIFF_FAMILIES = [
  {
    id: 'economy7',
    label: 'Economy 7',
    landingPageUrl:
      'https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/economy-7',
    pdfLinkPatterns: [/view\s*pdf/i],
    excludePatterns: [/archive/i, /historical/i, /previous/i, /\barchived\b/i]
  },
  {
    id: 'standard',
    label: 'Standard (24-hour)',
    landingPageUrl:
      'https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/electricity-price-comparison-table',
    pdfLinkPatterns: [/view\s*pdf/i],
    excludePatterns: [/archive/i, /historical/i, /previous/i, /\barchived\b/i]
  }
];
