import {
  generateRecoveryCodes,
  isRecoveryCodeShaped,
  isTotpShaped,
  normaliseRecoveryCode,
  recoveryCodeDigest,
  requiresMfaEnrollment,
} from '../../src/modules/iam/domain/mfa-policy';

/**
 * MFA policy: who is forced to enrol, and how recovery codes are shaped and
 * stored. Pure functions, so the whole surface is pinned without a container.
 */

describe('requiresMfaEnrollment', () => {
  it('does not require MFA for buyer-only accounts', () => {
    expect(requiresMfaEnrollment(['BUYER_ADMIN'])).toBe(false);
    expect(requiresMfaEnrollment(['BUYER_USER'])).toBe(false);
    expect(requiresMfaEnrollment(['BUYER_ADMIN', 'BUYER_USER'])).toBe(false);
  });

  it('requires MFA for every staff role', () => {
    const staff = [
      'SUPER_ADMIN',
      'TENANT_ADMIN',
      'CATALOG_MANAGER',
      'PRICING_MANAGER',
      'ORDER_MANAGER',
      'FINANCE',
      'WAREHOUSE_OPERATOR',
      'SALES_REP',
      'SUPPORT',
    ];
    for (const role of staff) {
      expect(requiresMfaEnrollment([role])).toBe(true);
    }
  });

  it('requires MFA for a custom (non-buyer) role — the deny-by-default direction', () => {
    // An allow-list of staff roles would silently exempt custom roles a tenant
    // creates later. A custom buyer-side role being asked to enrol is the
    // correct side to err on.
    expect(requiresMfaEnrollment(['REGIONAL_MANAGER'])).toBe(true);
  });

  it('requires MFA when staff and buyer roles are mixed', () => {
    expect(requiresMfaEnrollment(['BUYER_ADMIN', 'ORDER_MANAGER'])).toBe(true);
  });

  it('does not block an account that has no roles yet', () => {
    expect(requiresMfaEnrollment([])).toBe(false);
  });
});

describe('recovery code shapes', () => {
  it('generates the documented count of XXXXX-XXXXX codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    }
    expect(new Set(codes).size).toBe(10);
  });

  it('recognises recovery and TOTP shapes as mutually exclusive', () => {
    expect(isRecoveryCodeShaped('ABCDE-FGHIJ')).toBe(true);
    expect(isTotpShaped('ABCDE-FGHIJ')).toBe(false);

    expect(isTotpShaped('048392')).toBe(true);
    expect(isRecoveryCodeShaped('048392')).toBe(false);
  });

  it('normalises case and missing separators so a retyped code still matches', () => {
    expect(normaliseRecoveryCode('abcde-fghij')).toBe('ABCDE-FGHIJ');
    expect(normaliseRecoveryCode('ABCDEF GHIJ')).toBe('ABCDE-FGHIJ');
    expect(normaliseRecoveryCode('  abcdefghij ')).toBe('ABCDE-FGHIJ');
  });

  it('digests the canonical form, so however it was typed the hash matches', () => {
    expect(recoveryCodeDigest('abcde-fghij')).toBe(recoveryCodeDigest('ABCDE-FGHIJ'));
    expect(recoveryCodeDigest('ABCDE-FGHIJ')).toMatch(/^[0-9a-f]{64}$/);
  });
});
