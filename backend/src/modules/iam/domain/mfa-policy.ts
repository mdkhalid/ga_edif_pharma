import { randomBytes } from 'node:crypto';

import { SystemRole } from '@medichain/shared-types';

import { sha256Hex } from '../../../common/utils/crypto.util';
import { base32Encode } from './totp';

/**
 * MFA policy: who must enrol, and how recovery codes are stored.
 *
 * ## Who requires TOTP
 *
 * Every role except the two buyer roles. The admin security model calls for
 * mandatory second factors on staff accounts, and inverting the rule — an
 * allow-list of staff roles — would silently exempt any *custom* role a tenant
 * creates later, which is exactly the accounts an attacker would target first.
 *
 * A tenant that defines a custom buyer-side role will be asked to enrol. That
 * is the correct side to err on: a buyer told to set up an authenticator is
 * inconvenienced; a staff account without one is a breach waiting for a phish.
 */
const BUYER_ROLES: ReadonlySet<string> = new Set([
  SystemRole.BUYER_ADMIN,
  SystemRole.BUYER_USER,
]);

/**
 * True when sign-in must not issue a session until TOTP enrolment completes.
 *
 * An account with no roles yet (mid-registration) does not require MFA — it
 * cannot do anything anyway, and blocking it would strand every new account
 * behind a role assignment that has not happened.
 */
export function requiresMfaEnrollment(roleCodes: readonly string[]): boolean {
  if (roleCodes.length === 0) return false;
  return roleCodes.some((code) => !BUYER_ROLES.has(code));
}

// -------------------------------------------------------------------------
// Recovery codes
// -------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;
/** `ABCDE-FGHIJ` — five base32 characters, a dash, five more. */
const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{5}-[A-Z2-7]{5}$/u;

/**
 * Normalises a presented recovery code for digest comparison.
 *
 * Users retype codes without the dash or in lower case. Both are accepted at
 * the boundary; the digest is always of the canonical `XXXXX-XXXXX` form, so
 * one stored hash matches however the code was typed.
 */
export function normaliseRecoveryCode(input: string): string {
  const compact = input.trim().toUpperCase().replace(/[^A-Z2-7]/gu, '');
  if (compact.length !== 10) return input.trim().toUpperCase();
  return `${compact.slice(0, 5)}-${compact.slice(5)}`;
}

/** True when the presented value is shaped like a recovery code (not a TOTP). */
export function isRecoveryCodeShaped(input: string): boolean {
  return RECOVERY_CODE_PATTERN.test(normaliseRecoveryCode(input));
}

/** True when the presented value is shaped like a six-digit TOTP. */
export function isTotpShaped(input: string): boolean {
  return /^\d{6}$/u.test(input);
}

/** The stored form of a recovery code: SHA-256 of the canonical form. */
export function recoveryCodeDigest(code: string): string {
  return sha256Hex(normaliseRecoveryCode(code));
}

/**
 * Generates a fresh set of one-time recovery codes.
 *
 * Returned in plaintext exactly once — at enrolment — and stored only as
 * digests. Ten codes with 50 bits each is more headroom than a user will
 * realistically burn through, and each consumption removes one from the set so
 * a leaked list decays instead of remaining a permanent bypass.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = base32Encode(randomBytes(10)).slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}
