import { createHash } from 'node:crypto';

/** Immutable content identifier for a downloaded source document. */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
