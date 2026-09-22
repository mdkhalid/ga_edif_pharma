import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP — RFC 6238 over HOTP — RFC 4648 base32 secrets.
 *
 * Implemented here rather than pulled from a package for the same reason the
 * password policy is a value object: the rules are small, the failure modes are
 * security failures, and a unit test against the RFC's own test vectors is a
 * stronger statement than "the dependency's tests pass". The whole surface is
 * pure functions over a clock the caller supplies, so every branch is reachable
 * without waiting thirty seconds.
 *
 * ## Parameters
 *
 * 30-second step, 6 digits, SHA-1 — the Google Authenticator defaults, and what
 * every authenticator app assumes when it reads an `otpauth://` URI that does
 * not override them. Diverging would break enrollment on the commonest apps.
 *
 * ## The verification window
 *
 * `verifyTotp` accepts the previous, current and next step (`window = 1`).
 * Clock skew between the phone and the server is real, and a user typing a code
 * as the step rolls over would otherwise be rejected half the time. The window
 * is one step in each direction and no more: `window = 2` quadruples the number
 * of codes an attacker gets per guess for no practical benefit.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** 160 bits, the RFC 4226 recommended secret length for HMAC-SHA1. */
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ALGORITHM = 'sha1' as const;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, no padding — the encoding authenticator apps expect. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes RFC 4648 base32. Lower-case is accepted and normalised, because
 * humans paste secrets from a webpage in whatever case the page used.
 *
 * Throws on any character outside the alphabet: a silently ignored character
 * would decode to a *different* secret, and the resulting mismatch would look
 * like "your authenticator is wrong" forever.
 */
export function base32Decode(input: string): Buffer {
  const normalised = input.replace(/=+$/u, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalised) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** A fresh base32 shared secret for a new enrolment. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/**
 * HOTP — RFC 4226. Dynamic truncation of HMAC(key, counter).
 *
 * The counter is a `bigint` because RFC 6238's own test vectors include
 * 2^63, which does not fit a JS number without losing precision — and a
 * silently rounded counter would produce the wrong code at that instant.
 */
export function hotp(key: Buffer, counter: bigint, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);

  const digest = createHmac(TOTP_ALGORITHM, key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The HOTP counter for an instant: floor(seconds / step). */
export function totpCounter(atMs: number, stepSeconds: number = TOTP_STEP_SECONDS): bigint {
  return BigInt(Math.floor(atMs / 1000 / stepSeconds));
}

/** The current (or any instant's) six-digit code for a base32 secret. */
export function totp(secretBase32: string, atMs: number = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpCounter(atMs));
}

/**
 * Verifies a code against the secret, allowing ±1 step of clock skew.
 *
 * Every candidate is computed and compared — no early return on the first
 * match — so the comparison work does not depend on *which* window matched.
 * That costs two extra HMACs and removes a timing signal that would otherwise
 * tell an attacker how close their guess was.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number = Date.now(),
  window: number = 1,
): boolean {
  if (!/^\d{6}$/u.test(code)) return false;

  const key = base32Decode(secretBase32);
  const counter = totpCounter(atMs);
  const presented = Buffer.from(code, 'utf8');
  let matched = false;

  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = Buffer.from(hotp(key, counter + BigInt(offset)), 'utf8');
    // Compare equal-length buffers in constant time. Both are 6 ASCII bytes.
    if (candidate.length === presented.length && timingSafeEqual(candidate, presented)) {
      matched = true;
    }
  }

  return matched;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * `issuer:account` is the label format the apps parse; the `issuer` parameter
 * is repeated inside the query because some apps read one and some read the
 * other, and showing the wrong name in the app list is how people enrol the
 * wrong account.
 */
export function buildOtpauthUri(input: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: TOTP_ALGORITHM.toUpperCase(),
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
