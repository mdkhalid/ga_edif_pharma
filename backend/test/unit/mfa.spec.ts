import {
  ConflictError,
  MfaChallengeInvalidError,
  MfaCodeInvalidError,
  UnauthenticatedError,
} from '../../src/common/exceptions/domain.exception';
import { MfaService } from '../../src/modules/iam/application/services/mfa.service';
import { generateRecoveryCodes, recoveryCodeDigest } from '../../src/modules/iam/domain/mfa-policy';
import { base32Encode, generateTotpSecret, totp } from '../../src/modules/iam/domain/totp';

/**
 * MFA service: enrolment, confirmation, and second-factor sign-in.
 *
 * The properties pinned here are the ones that decide whether MFA actually
 * protects an account:
 *
 *   - enrolment must not flip `mfaEnabled` until a live code proves the app
 *     works (otherwise an admin can lock the account out by starting setup),
 *   - the challenge path must never issue a session on a wrong code,
 *   - recovery codes are single-use, and consuming one must leave the others,
 *   - every secret read/write runs without tenant scope (the user table is
 *     tenant-scoped; the login-time challenge runs before any tenant is known),
 *   - errors fail closed: a missing account is "not authenticated", never
 *     "wrong code", so probing cannot distinguish deleted from unenrolled.
 */

const USER = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'admin@sunrisepharma.local',
  phone: null,
  mfaEnabled: false,
  mfaSecret: null as string | null,
  mfaRecoveryCodes: [] as string[],
};

function makeMocks() {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ ...USER }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const uow = {
    transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ user: prisma.user }),
    ),
  };
  const tokens = {
    verifyMfaChallenge: jest.fn().mockResolvedValue({ userId: USER.id }),
  };
  const encryption = {
    encrypt: jest.fn((plaintext: string) => `enc:${plaintext}`),
    decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
  };
  const audit = { record: jest.fn(), recordInTransaction: jest.fn() };
  const auth = { issueLoginSession: jest.fn() };
  return { prisma, uow, tokens, encryption, audit, auth };
}

function makeService(mocks: ReturnType<typeof makeMocks>): MfaService {
  return new MfaService(
    mocks.prisma as never,
    mocks.uow as never,
    mocks.tokens as never,
    mocks.encryption as never,
    mocks.audit as never,
    mocks.auth as never,
  );
}

/** Base32 secret the service will see as the pending/enrolled secret. */
function currentTotp(secretBase32: string): string {
  return totp(secretBase32, Date.now());
}

describe('MfaService.setup', () => {
  it('stores an encrypted pending secret and does not enable MFA', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    const result = await service.setup({ userId: USER.id });

    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.otpauthUri).toContain('otpauth://totp/');
    expect(mocks.encryption.encrypt).toHaveBeenCalledWith(result.secret, `user:${USER.id}`);
    expect(mocks.prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER.id },
        data: { mfaSecret: expect.stringMatching(/^enc:/) },
      }),
    );
    const written = mocks.prisma.user.updateMany.mock.calls[0][0].data;
    expect(written).not.toHaveProperty('mfaEnabled');
  });

  it('replaces a pending secret rather than refusing a retry', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaSecret: 'enc:stale',
      mfaEnabled: false,
    });
    const service = makeService(mocks);

    const result = await service.setup({ userId: USER.id });

    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(mocks.prisma.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('refuses to restart enrolment while MFA is already on', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findUnique.mockResolvedValue({ ...USER, mfaEnabled: true });
    await expect(makeService(mocks).setup({ userId: USER.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when the account does not exist', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    await expect(makeService(mocks).setup({ userId: 'user-404' })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe('MfaService.confirm', () => {
  async function pendingSetup(mocks: ReturnType<typeof makeMocks>): Promise<string> {
    const secret = generateTotpSecret();
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaSecret: secret,
      mfaEnabled: false,
    });
    return secret;
  }

  it('enables MFA and returns one-time recovery codes stored only as digests', async () => {
    const mocks = makeMocks();
    const secret = await pendingSetup(mocks);
    const service = makeService(mocks);

    const result = await service.confirm({ userId: USER.id }, currentTotp(secret));

    expect(result.enabled).toBe(true);
    expect(result.recoveryCodes).toHaveLength(10);
    expect(result.session).toBeUndefined();

    const update = mocks.prisma.user.updateMany.mock.calls[0][0];
    expect(update.data.mfaEnabled).toBe(true);
    // The secret stays: future sign-ins still need to recompute codes.
    expect(update).not.toHaveProperty('data.mfaSecret');
    const stored: string[] = update.data.mfaRecoveryCodes.set;
    expect(stored).toHaveLength(10);
    for (const digest of stored) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(result.recoveryCodes[0]);
    expect(mocks.audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'auth.mfa.enabled' }),
    );
  });

  it('rejects a wrong code and leaves enrolment open', async () => {
    const mocks = makeMocks();
    await pendingSetup(mocks);
    const service = makeService(mocks);

    await expect(service.confirm({ userId: USER.id }, '000000')).rejects.toBeInstanceOf(
      MfaCodeInvalidError,
    );
    const enabling = mocks.prisma.user.updateMany.mock.calls.some(
      ([args]) => args.data?.mfaEnabled === true,
    );
    expect(enabling).toBe(false);
  });

  it('fails closed when there is no pending secret', async () => {
    const mocks = makeMocks();
    await expect(makeService(mocks).confirm({ userId: USER.id }, '123456')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('issues the withheld session when confirming against the sign-in challenge', async () => {
    const mocks = makeMocks();
    const secret = await pendingSetup(mocks);
    const session = {
      mfaRequired: false as const,
      tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900, tokenType: 'Bearer' as const },
      user: { id: USER.id },
    };
    mocks.auth.issueLoginSession.mockResolvedValue(session);
    const service = makeService(mocks);

    const result = await service.confirm(
      { userId: USER.id, challenge: { mfaToken: 'mfa.jwt' } },
      currentTotp(secret),
    );

    expect(result.session).toBe(session);
    expect(mocks.auth.issueLoginSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id }),
    );
  });
});

describe('MfaService.completeLogin', () => {
  function signInSession() {
    return {
      mfaRequired: false as const,
      tokens: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
        tokenType: 'Bearer' as const,
      },
      user: { id: USER.id },
    };
  }

  it('issues the session on a valid TOTP code', async () => {
    const mocks = makeMocks();
    const secret = generateTotpSecret();
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaEnabled: true,
      mfaSecret: secret,
    });
    const expected = signInSession();
    mocks.auth.issueLoginSession.mockResolvedValue(expected);
    const service = makeService(mocks);

    const result = await service.completeLogin({
      mfaToken: 'mfa.jwt',
      code: currentTotp(secret),
      deviceId: null,
      deviceLabel: null,
    });

    expect(result).toEqual(expected);
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.mfa.login.succeeded',
        metadata: { method: 'totp' },
      }),
    );
    // Recovery codes untouched on a TOTP success.
    expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid challenge before touching the user row', async () => {
    const mocks = makeMocks();
    mocks.tokens.verifyMfaChallenge.mockRejectedValue(new MfaChallengeInvalidError());
    const service = makeService(mocks);

    await expect(
      service.completeLogin({
        mfaToken: 'expired',
        code: '123456',
        deviceId: null,
        deviceLabel: null,
      }),
    ).rejects.toBeInstanceOf(MfaChallengeInvalidError);
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.auth.issueLoginSession).not.toHaveBeenCalled();
  });

  it('consumes a recovery code and keeps the other nine', async () => {
    const mocks = makeMocks();
    const codes = generateRecoveryCodes();
    const digests = codes.map(recoveryCodeDigest);
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaEnabled: true,
      mfaSecret: generateTotpSecret(),
      mfaRecoveryCodes: digests,
    });
    mocks.auth.issueLoginSession.mockResolvedValue(signInSession());
    const service = makeService(mocks);

    const used = codes[0] as string;
    await service.completeLogin({
      mfaToken: 'mfa.jwt',
      code: used,
      deviceId: null,
      deviceLabel: null,
    });

    const update = mocks.prisma.user.updateMany.mock.calls[0][0];
    expect(update.data.mfaRecoveryCodes.set).toEqual(digests.slice(1));
    expect(update.data.mfaRecoveryCodes.set).toHaveLength(9);
  });

  it('rejects a recovery code that was already consumed', async () => {
    const mocks = makeMocks();
    const code = generateRecoveryCodes()[0] as string;
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaEnabled: true,
      mfaSecret: generateTotpSecret(),
      mfaRecoveryCodes: generateRecoveryCodes().slice(1).map(recoveryCodeDigest),
    });
    const service = makeService(mocks);

    await expect(
      service.completeLogin({ mfaToken: 'mfa.jwt', code, deviceId: null, deviceLabel: null }),
    ).rejects.toBeInstanceOf(MfaCodeInvalidError);
    expect(mocks.auth.issueLoginSession).not.toHaveBeenCalled();
  });

  it('audits a failed second factor', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaEnabled: true,
      mfaSecret: generateTotpSecret(),
    });
    const service = makeService(mocks);

    await expect(
      service.completeLogin({
        mfaToken: 'mfa.jwt',
        code: '000000',
        deviceId: null,
        deviceLabel: null,
      }),
    ).rejects.toBeInstanceOf(MfaCodeInvalidError);
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.mfa.login.failed', outcome: 'FAILURE' }),
    );
  });

  it('fails closed when the account is not enrolled under a live challenge', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findUnique.mockResolvedValue({ ...USER, mfaEnabled: false });
    const service = makeService(mocks);

    await expect(
      service.completeLogin({
        mfaToken: 'mfa.jwt',
        code: '123456',
        deviceId: null,
        deviceLabel: null,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('MfaService.disable', () => {
  it('requires a live code and wipes secret and recovery codes', async () => {
    const mocks = makeMocks();
    const secret = generateTotpSecret();
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaEnabled: true,
      mfaSecret: secret,
      mfaRecoveryCodes: generateRecoveryCodes().map(recoveryCodeDigest),
    });
    const service = makeService(mocks);

    const result = await service.disable(USER.id, currentTotp(secret));

    expect(result).toEqual({ enabled: false });
    const update = mocks.prisma.user.updateMany.mock.calls[0][0];
    expect(update.data).toEqual({
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: { set: [] },
    });
    expect(mocks.audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'auth.mfa.disabled' }),
    );
  });

  it('refuses to disable when MFA is not on', async () => {
    const mocks = makeMocks();
    await expect(makeService(mocks).disable(USER.id, '123456')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('rejects a wrong code rather than silently turning MFA off', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaEnabled: true,
      mfaSecret: generateTotpSecret(),
    });
    await expect(makeService(mocks).disable(USER.id, '000000')).rejects.toBeInstanceOf(
      MfaCodeInvalidError,
    );
    expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown account', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    await expect(makeService(mocks).disable('user-404', '123456')).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe('MfaService.verifyChallenge', () => {
  it('delegates to the token service', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    await expect(service.verifyChallenge('mfa.jwt')).resolves.toEqual({ userId: USER.id });
    expect(mocks.tokens.verifyMfaChallenge).toHaveBeenCalledWith('mfa.jwt');
  });
});

describe('base32 secret round-trip through the service envelope', () => {
  it('setup returns a secret that confirm then accepts', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    const setup = await service.setup({ userId: USER.id });
    const written = mocks.prisma.user.updateMany.mock.calls[0][0].data.mfaSecret as string;
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...USER,
      mfaSecret: written.replace(/^enc:/, ''),
      mfaEnabled: false,
    });

    const result = await service.confirm({ userId: USER.id }, currentTotp(setup.secret));
    expect(result.enabled).toBe(true);
    // The stored form in the DB is the envelope; the mock decrypt strips it.
    expect(base32Encode(Buffer.from(setup.secret, 'utf8'))).toMatch(/^[A-Z2-7]+$/);
  });
});
