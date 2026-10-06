import { createHash } from 'node:crypto';

const HASH_LENGTH = 6;

/** Short, stable hex digest of a string (used to keep truncated names unique). */
export function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * `${base}${suffix}` when it fits in `maxLength`, otherwise the base is
 * truncated and a hash of the full base is inserted so two long stack names
 * that share a prefix still get distinct physical names. Short names are left
 * untouched so existing deployments keep their resource names.
 */
export function boundedName(base: string, suffix: string, maxLength: number): string {
  const full = `${base}${suffix}`;
  if (full.length <= maxLength) {
    return full;
  }
  const keep = maxLength - suffix.length - HASH_LENGTH - 1;
  if (keep < 1) {
    throw new Error(`Cannot fit "${suffix}" into a ${maxLength}-character name`);
  }
  return `${base.slice(0, keep)}-${shortHash(base)}${suffix}`;
}
