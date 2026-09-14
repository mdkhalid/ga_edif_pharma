import {
  OtpAttemptsExceededError,
  OtpExpiredError,
  OtpInvalidError,
} from '../../src/common/exceptions/domain.exception';
import { sha256Hex } from '../../src/common/utils/crypto.util';
import { OTP_CODE_LENGTH, OtpService } from '../../src/modules/iam/application/services/otp.service';

/**
 * One-time-code mechanics.
 *
 * This is a security boundary: a six-digit code with a million possible values is
 * only safe because it is single-use, short-lived, addressed to one destination,
 * and attempt-capped. Each of those properties is pinned here, because the failure
 * mode of getting one wrong is silent — the flow still works, and the code is
 * brute-forceable.
 *
 * The service is constructed directly rather than through a Nest testing module.
 * Its collaborators are four plain interfaces, so there is nothing for the
 * container to resolve, and a real container would only add the Prisma client the
 * mocks exist to avoid.
 */

const PURPOSE = 'VERIFY_CONTACT';

function makeMocks() {
  const txChallenge = { create: jest.fn(), updateMany: jest.fn() };
  const prisma = {
    otpChallenge: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  };
  const uow = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ otpChallenge: txChallenge })) };
  const notifications = { sendOtp: jest.fn().mockResolvedValue(undefined) };
  const config = { authOtp: { ttlMinutes: 10, maxAttempts: 5, exposeInResponse: false } };
  return { prisma, txChallenge, uow, notifications, config };
}

function makeService(mocks: ReturnType<typeof makeMocks>): OtpService {
  return new OtpService(
    mocks.prisma as never,
    mocks.uow as never,
    mocks.notifications as never,
    mocks.config as never,
  );
}

/** A challenge row as Prisma would return it, with the code already digested. */
function challengeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'challenge-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    codeHash: sha256Hex('123456'),
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe('OtpService.issue', () => {
  it('generates a six-digit numeric code', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    const issued = await service.issue({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    expect(issued.code).toMatch(new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`));
  });

  it('persists only the digest of the code, never the code itself', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    const issued = await service.issue({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    const created = mocks.txChallenge.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };

    // Asserted against the digest rather than by scanning for the plaintext: a
    // 64-character hex digest can coincidentally contain a six-digit run, which
    // would make a substring assertion flaky roughly once in twenty thousand runs.
    expect(created.data.codeHash).toBe(sha256Hex(issued.code));
    expect(created.data.codeHash).not.toBe(issued.code);
  });

  it('supersedes any outstanding code for the same destination and purpose', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    await service.issue({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    // Without this, "request a new code" leaves the previous one live and the
    // window in which any emailed code works keeps widening.
    expect(mocks.txChallenge.updateMany).toHaveBeenCalledWith({
      where: { destination: 'admin@sunrisepharma.local', purpose: PURPOSE, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('records the owner, tenant and attempt cap from configuration', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    await service.issue({
      destination: '+919876543210',
      purpose: PURPOSE,
      userId: 'user-7',
      tenantId: 'tenant-9',
    });

    const created = mocks.txChallenge.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data).toMatchObject({
      destination: '+919876543210',
      purpose: PURPOSE,
      userId: 'user-7',
      tenantId: 'tenant-9',
      maxAttempts: 5,
    });
  });

  it('sets the expiry from the configured TTL', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    const before = Date.now();
    const issued = await service.issue({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      userId: null,
      tenantId: null,
    });

    const ttlMs = issued.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(9 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60_000);
  });

  it('delivers the code with its destination, purpose and lifetime', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    const issued = await service.issue({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    expect(mocks.notifications.sendOtp).toHaveBeenCalledWith({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      code: issued.code,
      expiresInMinutes: 10,
    });
  });

  it('delivers only after the challenge has been committed', async () => {
    // A notification sent inside the transaction would be re-sent on a retry and
    // could announce a code whose row rolled back.
    const mocks = makeMocks();
    const order: string[] = [];
    mocks.uow.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      order.push('transaction');
      return fn({ otpChallenge: mocks.txChallenge });
    });
    mocks.notifications.sendOtp.mockImplementation(async () => {
      order.push('send');
    });

    await makeService(mocks).issue({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      userId: null,
      tenantId: null,
    });

    expect(order).toEqual(['transaction', 'send']);
  });
});

describe('OtpService.consume', () => {
  it('accepts the correct code and marks the challenge consumed', async () => {
    const mocks = makeMocks();
    mocks.prisma.otpChallenge.findFirst.mockResolvedValue(challengeRow());
    mocks.prisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

    const consumed = await makeService(mocks).consume({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      code: '123456',
    });

    expect(consumed).toEqual({ id: 'challenge-1', userId: 'user-1', tenantId: 'tenant-1' });
    // `consumedAt: null` in the WHERE clause is what makes this single-use.
    expect(mocks.prisma.otpChallenge.updateMany).toHaveBeenCalledWith({
      where: { id: 'challenge-1', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('looks the challenge up by destination and purpose, newest first', async () => {
    const mocks = makeMocks();
    mocks.prisma.otpChallenge.findFirst.mockResolvedValue(challengeRow());
    mocks.prisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

    await makeService(mocks).consume({
      destination: 'admin@sunrisepharma.local',
      purpose: PURPOSE,
      code: '123456',
    });

    // The purpose is part of the lookup: a code issued to verify a contact must
    // not be accepted to reset a password.
    expect(mocks.prisma.otpChallenge.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { destination: 'admin@sunrisepharma.local', purpose: PURPOSE, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('rejects when there is no live challenge', async () => {
    const mocks = makeMocks();
    mocks.prisma.otpChallenge.findFirst.mockResolvedValue(null);

    await expect(
      makeService(mocks).consume({
        destination: 'admin@sunrisepharma.local',
        purpose: PURPOSE,
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });

  it('rejects an expired code', async () => {
    const mocks = makeMocks();
    mocks.prisma.otpChallenge.findFirst.mockResolvedValue(
      challengeRow({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    await expect(
      makeService(mocks).consume({
        destination: 'admin@sunrisepharma.local',
        purpose: PURPOSE,
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(OtpExpiredError);
  });

  it('rejects immediately once the attempt cap is already reached', async () => {
    const mocks = makeMocks();
    mocks.prisma.otpChallenge.findFirst.mockResolvedValue(challengeRow({ attempts: 5, maxAttempts: 5 }));

    await expect(
      makeService(mocks).consume({
        destination: 'admin@sunrisepharma.local',
        purpose: PURPOSE,
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(OtpAttemptsExceededError);

    // No verification work, and no further increment.
    expect(mocks.prisma.otpChallenge.update).not.toHaveBeenCalled();
  });

  it('counts a wrong attempt and rejects it', async () => {
    const mocks = makeMocks();
    mocks.prisma.otpChallenge.findFirst.mockResolvedValue(challengeRow());
    mocks.prisma.otpChallenge.update.mockResolvedValue({ attempts: 1, maxAttempts: 5 });

    await expect(
      makeService(mocks).consume({
        destination: 'admin@sunrisepharma.local',
        purpose: PURPOSE,
        code: '999999',
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);

    // Atomic increment, not a read-then-write: two parallel guesses must both count.
    expect(mocks.prisma.otpChallenge.update).toHaveBeenCalledWith({
      where: { id: 'challenge-1' },
      data: { attempts: { increment: 1 } },
      select: { attempts: true, maxAttempts: true },
    });
    expect(mocks.prisma.otpChallenge.updateMany).not.toHaveBeenCalled();
  });

  it('reports the cap, not a generic mismatch, when the wrong guess exhausts it', async () => {
    const mocks = makeMocks();
    mocks.prisma.otpChallenge.findFirst.mockResolvedValue(challengeRow({ attempts: 4, maxAttempts: 5 }));
    mocks.prisma.otpChallenge.update.mockResolvedValue({ attempts: 5, maxAttempts: 5 });

    await expect(
      makeService(mocks).consume({
        destination: 'admin@sunrisepharma.local',
        purpose: PURPOSE,
        code: '999999',
      }),
    ).rejects.toBeInstanceOf(OtpAttemptsExceededError);
  });

  it('rejects a code that another request consumed first', async () => {
    const mocks = makeMocks();
    mocks.prisma.otpChallenge.findFirst.mockResolvedValue(challengeRow());
    // The compare-and-set lost: another caller claimed the same challenge.
    mocks.prisma.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      makeService(mocks).consume({
        destination: 'admin@sunrisepharma.local',
        purpose: PURPOSE,
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });
});
