/**
 * Source-state provenance records, one per tariff family.
 *
 * These are committed to the repository under `monitoring/source-state/`
 * (see docs/SOURCE-MONITORING.md for why version control rather than a
 * workflow cache) but are written only when something about the source has
 * actually changed — `writeStateIfChanged` never touches the file for an
 * unchanged source, so a scheduled run that finds nothing new produces no
 * git diff at all, timestamps included.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_DIR = fileURLToPath(new URL('../../monitoring/source-state/', import.meta.url));

function statePath(familyId) {
  return join(STATE_DIR, `${familyId}.json`);
}

/** Returns the previously recorded state for a family, or null if none exists yet. */
export function readState(familyId) {
  const path = statePath(familyId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Builds the state record for a freshly discovered/downloaded source.
 * `checkedAt` should be an ISO-8601 timestamp.
 */
export function buildStateRecord({ family, candidate, hash, length, headers, checkedAt }) {
  return {
    tariff_family: family.id,
    tariff_family_label: family.label,
    landing_page_url: family.landingPageUrl,
    pdf_url: candidate.url,
    discovered_link_text: candidate.text,
    content_sha256: hash,
    content_length_bytes: length,
    http_last_modified: headers?.lastModified ?? null,
    http_etag: headers?.etag ?? null,
    http_content_type: headers?.contentType ?? null,
    checked_at: checkedAt
  };
}

const COMPARABLE_FIELDS = ['pdf_url', 'content_sha256'];

function sourceChanged(previous, current) {
  if (!previous) return true;
  return COMPARABLE_FIELDS.some((field) => previous[field] !== current[field]);
}

/**
 * Compares the previous recorded state to the freshly discovered one.
 * Returns { status, reasons } where status is one of:
 *   'new'       — no previous state existed
 *   'unchanged' — same PDF URL and same content hash
 *   'changed'   — different PDF URL and/or different content hash
 * `reasons` lists which of 'url' / 'content' differed (empty for 'new'/'unchanged').
 */
export function compareState(previous, current) {
  if (!previous) return { status: 'new', reasons: [] };

  const reasons = [];
  if (previous.pdf_url !== current.pdf_url) reasons.push('url');
  if (previous.content_sha256 !== current.content_sha256) reasons.push('content');

  return { status: reasons.length > 0 ? 'changed' : 'unchanged', reasons };
}

/** Writes the state file only if the source has actually changed (or is new). */
export function writeStateIfChanged(familyId, previous, current) {
  if (!sourceChanged(previous, current)) return false;
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(familyId), JSON.stringify(current, null, 2) + '\n', 'utf8');
  return true;
}

export function stateDir() {
  return STATE_DIR;
}
