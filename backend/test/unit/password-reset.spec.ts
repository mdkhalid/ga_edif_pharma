import {
  OtpInvalidError,
  ValidationFailedError,
} from '../../src/common/exceptions/domain.exception';
import { PasswordResetService } from '../../src/modules/iam/application/services/password-reset.service';

/**
 * Password reset flow.
 *
 * Three properties are worth pinning, and each is a way this endpoint is commonly
 * got wrong:
 *
 *   - it must not reveal whether an account exists (no enumeration),
 *   - it must not spend argon2 CPU before the code has been accepted (otherwise an
 *     unauthenticated caller has a CPU-exhaustion lever),
 *   - it must revoke every existing session, so a stolen session does not outlive
 *     the reset.
 */

const ACCOUNT = {
  id: 'user-1',
  tenantId: 'tenant-1',
  status: 'ACTIVE',
  email: 'admin@sunrisepharma.local',
  phone: null,
  fullName: 'Priya Sharma',
};

const STRONG_PASSWORD = 'correct-horse-battery-staple';

function makeMocks() {
  const prisma = { user: { findFirst: jest.fn() } };
  const txUser = { update: jest.fn() };
  const uow = {
    transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ user: txUser })),
  };
  const otp = { issue: jest.fn(), consume: jest.fn() };
  const passwords = { hash: jest.fn() };
  const sessions = { revokeAllForUser: jest.fn() };
  const audit = { recordInTransaction: jest.fn() };
  const config = { authOtp: { ttlMinutes: 10, maxAttempts: 5, exposeInResponse: false } };
  return { prisma, txUser, uow, otp, passwords, sessions, audit, config };
}

function makeService(mocks: ReturnType<typeof makeMocks>): PasswordResetService {
  return new PasswordResetService(
    mocks.prisma as never,
    mocks.uow as never,
    mocks.otp as never,
    mocks.passwords as never,
    mocks.sessions as never,
    mocks.audit as never,
    mocks.config as never,
  );
}

describe('PasswordResetService.forgot', () => {
  it('issues a reset code addressed to the account', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(ACCOUNT);
    mocks.otp.issue.mockResolvedValue({ code: '111111', expiresAt: new Date('2030-01-01T00:00:00Z') });

    const result = await makeService(mocks).forgot('admin@sunrisepharma.local');

    expect(mocks.otp.issue).toHaveBeenCalledWith({
      destination: 'admin@sunrisepharma.local',
      purpose: 'RESET_PASSWORD',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(result.expiresAt).toEqual(new Date('2030-01-01T00:00:00Z'));
    expect(result.devCode).toBeUndefined();
  });

  it('answers identically for an identifier with no account, and sends nothing', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(null);

    const result = await makeService(mocks).forgot('nobody@nowhere.local');

    // The whole point: a caller cannot tell this apart from the found case.
    expect(mocks.otp.issue).not.toHaveBeenCalled();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.devCode).toBeUndefined();
  });

  it('exposes the code only when the dev flag is on', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(ACCOUNT);
    mocks.otp.issue.mockResolvedValue({ code: '222222', expiresAt: new Date() });
    mocks.config.authOtp.exposeInResponse = true;

    const result = await makeService(mocks).forgot('admin@sunrisepharma.local');

    expect(result.devCode).toBe('222222');
  });

  it('still sends nothing, and exposes nothing, for an unknown account when the flag is on', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(null);
    mocks.config.authOtp.exposeInResponse = true;

    const result = await makeService(mocks).forgot('nobody@nowhere.local');

    expect(result.devCode).toBeUndefined();
  });
});

describe('PasswordResetService.reset', () => {
  it('consumes the code, rehashes, audits and revokes every session', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(ACCOUNT);
    mocks.otp.consume.mockResolvedValue({ id: 'c1', userId: 'user-1', tenantId: 'tenant-1' });
    mocks.passwords.hash.mockResolvedValue('$argon2id$v=19$m=19456,t=2,p=1$stored');
    mocks.sessions.revokeAllForUser.mockResolvedValue(3);

    const result = await makeService(mocks).reset({
      identifier: 'admin@sunrisepharma.local',
      code: '123456',
      newPassword: STRONG_PASSWORD,
    });

    expect(result).toEqual({ reset: true, revokedSessions: 3 });
    expect(mocks.otp.consume).toHaveBeenCalledWith({
      destination: 'admin@sunrisepharma.local',
      purpose: 'RESET_PASSWORD',
      code: '123456',
    });
    expect(mocks.txUser.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$stored',
        passwordChangedAt: expect.any(Date),
        failedLoginAttempts: 0,
        lockedUntil: null,
      }),
    });
    expect(mocks.audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'auth.password.reset', entityId: 'user-1' }),
    );
    // PASSWORD_CHANGED, not LOGOUT: every session dies, including any an attacker
    // established with the old password.
    expect(mocks.sessions.revokeAllForUser).toHaveBeenCalledWith('user-1', 'PASSWORD_CHANGED');
  });

  it('rejects an identifier that cannot be canonicalised, before any lookup', async () => {
    const mocks = makeMocks();

    await expect(
      makeService(mocks).reset({ identifier: '   ', code: '123456', newPassword: STRONG_PASSWORD }),
    ).rejects.toBeInstanceOf(OtpInvalidError);

    expect(mocks.prisma.user.findFirst).not.toHaveBeenCalled();
    expect(mocks.otp.consume).not.toHaveBeenCalled();
  });

  it('rejects an unknown account without touching the code', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      makeService(mocks).reset({
        identifier: 'nobody@nowhere.local',
        code: '123456',
        newPassword: STRONG_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);

    expect(mocks.otp.consume).not.toHaveBeenCalled();
  });

  it('rejects an off-policy password before consuming the code or hashing', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(ACCOUNT);

    await expect(
      makeService(mocks).reset({
        identifier: 'admin@sunrisepharma.local',
        code: '123456',
        newPassword: 'short',
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    // A password the policy will never accept must not burn the user's code, and
    // must not spend argon2 CPU.
    expect(mocks.otp.consume).not.toHaveBeenCalled();
    expect(mocks.passwords.hash).not.toHaveBeenCalled();
  });

  it('does not hash until the code has been accepted', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(ACCOUNT);
    mocks.otp.consume.mockRejectedValue(new OtpInvalidError());

    await expect(
      makeService(mocks).reset({
        identifier: 'admin@sunrisepharma.local',
        code: '000000',
        newPassword: STRONG_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);

    // This ordering is the defence against an unauthenticated caller forcing
    // 19 MiB of hashing work per request without presenting a valid code.
    expect(mocks.passwords.hash).not.toHaveBeenCalled();
  });

  it('rejects a code that belongs to a different account, without hashing', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(ACCOUNT);
    mocks.otp.consume.mockResolvedValue({ id: 'c1', userId: 'somebody-else', tenantId: 'tenant-1' });

    await expect(
      makeService(mocks).reset({
        identifier: 'admin@sunrisepharma.local',
        code: '123456',
        newPassword: STRONG_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);

    expect(mocks.passwords.hash).not.toHaveBeenCalled();
    expect(mocks.sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});
