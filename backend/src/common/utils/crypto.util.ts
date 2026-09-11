import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Low-level cryptographic helpers.
 *
 * Everything here is deterministic and dependency-free so it can be unit-tested
 * without a database, a clock, or a running application.
 */

/** 256 bits of entropy, base64url-encoded. The size used for refresh tokens. */
export const TOKEN_BYTES = 32;

/**
 * Generates an opaque, URL-safe random token.
 *
 * Used for refresh tokens, OTP challenges and email-verification links. These
 * are *lookup* secrets, not passwords: they carry full entropy from a CSPRNG, so
 * they are stored as a fast SHA-256 digest rather than an argon2 hash. Argon2's
 * cost is only justified when the input is guessable.
 */
export function randomToken(bytes: number = TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

/** Numeric OTP of the given length, uniformly distributed. */
export function randomNumericCode(length = 6): string {
  // Rejection sampling would be overkill at this length; the modulo bias over a
  // 4-byte draw into 10^6 buckets is far below any practical significance, and
  // the code is rate-limited and short-lived regardless.
  const max = 10 ** length;
  const value = randomBytes(4).readUInt32BE(0) % max;
  return value.toString().padStart(length, '0');
}

/** SHA-256, hex-encoded. Used for fingerprints and cache keys. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** SHA-256, base64-encoded. Used for stored refresh-token digests. */
export function sha256Base64(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64');
}

/** SHA-256 of a JSON value with a stable key order. */
export function stableJsonDigest(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

/**
 * JSON with recursively sorted object keys.
 *
 * `JSON.stringify({a:1,b:2})` and `JSON.stringify({b:2,a:1})` differ, which
 * would make an idempotency fingerprint depend on key insertion order — the
 * same logical request would look like a different one. Sorting removes that.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/**
 * Length-safe, constant-time string comparison.
 *
 * `timingSafeEqual` throws when the buffers differ in length, which leaks the
 * length through the thrown error. Hashing both sides first normalises them to
 * 32 bytes, so the comparison is constant-time *and* total.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** Cryptographically strong random integer in `[0, maxExclusive)`. */
export function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new RangeError('maxExclusive must be positive.');
  return randomBytes(4).readUInt32BE(0) % maxExclusive;
}

/**
 * Derives a deterministic UUID-shaped id from a natural key.
 *
 * Used by seeds and idempotent data migrations so re-running them targets the
 * same rows instead of creating duplicates.
 */
export function deterministicUuid(namespace: string, value: string): string {
  const hex = sha256Hex(`${namespace}:${value}`).slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
