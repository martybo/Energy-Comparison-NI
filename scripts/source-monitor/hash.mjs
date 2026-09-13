import { createHash } from 'node:crypto';

/** Immutable content identifier for a downloaded source document. */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Returns a copy of `buffer` with volatile PDF regeneration artefacts
 * neutralised, for hashing purposes only — never used for the stored file,
 * the %PDF- signature check, or anything else that needs the real bytes.
 *
 * Verified live against the Consumer Council's print/pdf endpoint (issue
 * #16): fetching the identical, unchanged document twice a few seconds
 * apart produced different raw bytes in exactly three places — /CreationDate
 * and /ModDate (both stamped with the current time on every request) and the
 * trailer's /ID hex pair (apparently derived from that timestamp) — with
 * every other byte, including the entire rendered table, byte-for-byte
 * identical. Hashing the raw bytes directly would report "changed" on every
 * single run regardless of whether the tariff data actually changed, which
 * is exactly the meaningless-churn failure mode issue #14 was designed to
 * avoid. Masking only these three well-known, purely administrative PDF
 * fields cannot hide a real content change — an edit to the visible table
 * necessarily changes other bytes too — while removing this specific,
 * confirmed source of false positives.
 */
export function stableContentBytes(buffer) {
  let text = buffer.toString('latin1');
  text = text.replace(/(\/CreationDate\s*\()[^)]*(\))/, '$1REDACTED$2');
  text = text.replace(/(\/ModDate\s*\()[^)]*(\))/, '$1REDACTED$2');
  text = text.replace(/(\/ID\s*\[)\s*<[0-9a-fA-F]*>\s*<[0-9a-fA-F]*>\s*(\])/, '$1REDACTED$2');
  return Buffer.from(text, 'latin1');
}
