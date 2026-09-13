/**
 * Discovers the "current" PDF link for a tariff family from a Consumer
 * Council landing page's raw HTML.
 *
 * This intentionally does not use an HTML parsing dependency (the repository
 * is zero-dependency) — it uses a small tag-scanning regex, which is
 * sufficient for finding `<a href="...">` links and heading text. It is not
 * a general HTML parser and is not meant to be one: anything it cannot make
 * sense of is treated as a discovery failure, never guessed at.
 */

import { ARCHIVE_HEADING_PATTERN } from './sources.mjs';

export class SourceDiscoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SourceDiscoveryError';
    this.code = code;
    this.details = details;
  }
}

const ANCHOR_PATTERN = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
const HEADING_PATTERN = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the offset of the first heading whose text looks like the start
 * of an archive/historical section, or -1 if none is found. Everything from
 * that offset onward is excluded from "current document" discovery.
 */
function findArchiveSectionStart(html) {
  HEADING_PATTERN.lastIndex = 0;
  let match;
  while ((match = HEADING_PATTERN.exec(html)) !== null) {
    const headingText = stripTags(match[1]);
    if (ARCHIVE_HEADING_PATTERN.test(headingText)) {
      return match.index;
    }
  }
  return -1;
}

/** Extracts every `<a href>` link from an HTML fragment as {url, text}. */
export function extractLinks(html, baseUrl) {
  ANCHOR_PATTERN.lastIndex = 0;
  const links = [];
  let match;
  while ((match = ANCHOR_PATTERN.exec(html)) !== null) {
    const rawHref = match[1] ?? match[2] ?? '';
    const text = stripTags(match[3]);
    let resolved;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      continue; // not a resolvable URL (e.g. "javascript:void(0)") — skip
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    links.push({ url: resolved.href, text });
  }
  return links;
}

function hasPdfExtension(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  return pathname.endsWith('.pdf');
}

function matchesAny(patterns, ...haystacks) {
  return patterns.some((pattern) => haystacks.some((h) => pattern.test(h)));
}

/**
 * Whether `link` looks like the site's PDF/printable representation of the
 * current table. Verified live against the real Consumer Council site
 * (2026-09-13): the actual link is a "View PDF" anchor pointing at
 * /print/pdf/node/<id> — a Drupal print endpoint, not a literal .pdf file —
 * so a literal .pdf extension can never be the only signal. Matching a
 * link's own text/URL against `pdfLinkPatterns` (e.g. "View PDF") is a
 * second, independent signal accepted alongside a literal .pdf extension.
 * `assertIsPdf` still verifies the downloaded bytes afterwards regardless of
 * which signal matched, so a wrong match here is caught before it can ever
 * become a "current source".
 */
function looksLikePdfLink(link, family) {
  if (hasPdfExtension(link.url)) return true;
  if (family.pdfLinkPatterns && matchesAny(family.pdfLinkPatterns, link.text, link.url)) return true;
  return false;
}

/**
 * Finds PDF link candidates for `family` within `html`, restricted to the
 * part of the page before any detected archive/historical section, and
 * filtered by the family's exclude patterns. Returns a deduplicated array of
 * {url, text}.
 *
 * Family disambiguation (picking the right family out of several PDFs on one
 * page) is intentionally not attempted by matching the candidate link's own
 * text against the family name: the real "View PDF" link never mentions
 * "Economy 7" or similar. Each family is instead scoped by fetching its own
 * dedicated landing page (`family.landingPageUrl`) — a page a family
 * publishes its own comparison table on is assumed to link its own current
 * PDF, not another family's.
 */
export function findCandidatePdfLinks(html, baseUrl, family) {
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new SourceDiscoveryError('EMPTY_PAGE', `Landing page for "${family.id}" returned no usable content`);
  }

  const archiveStart = findArchiveSectionStart(html);
  const currentZoneHtml = archiveStart === -1 ? html : html.slice(0, archiveStart);

  const links = extractLinks(currentZoneHtml, baseUrl).filter((link) => {
    if (!looksLikePdfLink(link, family)) return false;
    if (family.excludePatterns && matchesAny(family.excludePatterns, link.text, link.url)) return false;
    return true;
  });

  const byUrl = new Map();
  for (const link of links) {
    if (!byUrl.has(link.url)) byUrl.set(link.url, link);
  }
  return [...byUrl.values()];
}

/**
 * Selects the single current PDF candidate for `family` from `html`, or
 * throws a SourceDiscoveryError describing exactly why no safe selection
 * could be made.
 */
export function selectCurrentPdf(html, baseUrl, family) {
  const candidates = findCandidatePdfLinks(html, baseUrl, family);

  if (candidates.length === 0) {
    throw new SourceDiscoveryError(
      'NO_PDF_FOUND',
      `No candidate PDF link found for tariff family "${family.id}" on ${baseUrl}`,
      { baseUrl }
    );
  }

  if (candidates.length > 1) {
    throw new SourceDiscoveryError(
      'AMBIGUOUS_CANDIDATES',
      `Found ${candidates.length} equally plausible PDF candidates for tariff family "${family.id}" on ${baseUrl}: ` +
        candidates.map((c) => c.url).join(', '),
      { baseUrl, candidates }
    );
  }

  return candidates[0];
}

const PDF_MAGIC_BYTES = Buffer.from('%PDF-', 'ascii');

/** Throws if `buffer` does not start with the PDF file signature. */
export function assertIsPdf(buffer, sourceUrl) {
  const header = Buffer.isBuffer(buffer) ? buffer.subarray(0, PDF_MAGIC_BYTES.length) : Buffer.alloc(0);
  if (!header.equals(PDF_MAGIC_BYTES)) {
    throw new SourceDiscoveryError(
      'NOT_A_PDF',
      `Discovered document at ${sourceUrl} is not a PDF (missing %PDF- file signature)`,
      { sourceUrl }
    );
  }
}
