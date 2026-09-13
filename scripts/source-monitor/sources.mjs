/**
 * Configuration for the tariff families this tool monitors.
 *
 * Each family names the Consumer Council landing page that is authoritative
 * for "what is the current PDF", plus the text/URL patterns that identify a
 * link on that page as belonging to this family rather than some other
 * document (another tariff family, an archived table, an unrelated fuel).
 *
 * `includePatterns` (at least one must match a candidate's link text or URL)
 * and `excludePatterns` (none may match) are deliberately conservative: a
 * page whose real structure does not fit this shape should fail discovery
 * rather than have the tool guess.
 */

export const ARCHIVE_HEADING_PATTERN = /archive|historical|previous|superseded|past\s+(table|price)/i;

export const TARIFF_FAMILIES = [
  {
    id: 'economy7',
    label: 'Economy 7',
    landingPageUrl:
      'https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/economy-7',
    includePatterns: [/economy\s*7/i],
    excludePatterns: [/archive/i, /historical/i, /previous/i, /\barchived\b/i]
  },
  {
    id: 'standard',
    label: 'Standard (24-hour)',
    landingPageUrl:
      'https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/electricity-price-comparison-table',
    includePatterns: [/electricity price comparison/i, /24[\s-]?hour/i, /\bstandard\b/i],
    excludePatterns: [/economy\s*7/i, /archive/i, /historical/i, /previous/i, /\barchived\b/i]
  }
];
