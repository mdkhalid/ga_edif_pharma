import { OtpInvalidError } from '../../src/common/exceptions/domain.exception';
import { ContactVerificationService } from '../../src/modules/iam/application/services/contact-verification.service';

/**
 * Contact verification.
 *
 * This is the step that turns a `PENDING_VERIFICATION` account into an `ACTIVE`
 * one, so it is an authorisation boundary: a bug that activates on the wrong code,
 * or for the wrong account, is an auth bypass. The properties pinned here are the
 * ones that would be silent if broken — no enumeration on request, activation only
 * after the code is accepted, and the challenge owner checked against the account.
 */

const PENDING_ACCOUNT = {
  id: 'user-1',
  tenantId: 'tenant-1',
  status: 'PENDING_VERIFICATION',
  email: 'buyer@sunrisepharma.local',
  phone: null,
  fullName: 'Priya Sharma',
};

function makeMocks() {
  const prisma = { user: { findFirst: jest.fn() } };
  const txUser = { update: jest.fn() };
  const uow = {
    transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ user: txUser })),
  };
  const otp = { issue: jest.fn(), consume: jest.fn() };
  const audit = { recordInTransaction: jest.fn() };
  const config = { authOtp: { ttlMinutes: 10, maxAttempts: 5, exposeInResponse: false } };
  return { prisma, txUser, uow, otp, audit, config };
}

function makeService(mocks: ReturnType<typeof makeMocks>): ContactVerificationService {
  return new ContactVerificationService(
    mocks.prisma as never,
    mocks.uow as never,
    mocks.otp as never,
    mocks.audit as never,
    mocks.config as never,
  );
}

describe('ContactVerificationService.request', () => {
  it('issues a VERIFY_CONTACT code for a pending account', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(PENDING_ACCOUNT);
    mocks.otp.issue.mockResolvedValue({ code: '111111', expiresAt: new Date('2030-01-01T00:00:00Z') });

    const result = await makeService(mocks).request('buyer@sunrisepharma.local');

    expect(mocks.otp.issue).toHaveBeenCalledWith({
      destination: 'buyer@sunrisepharma.local',
      purpose: 'VERIFY_CONTACT',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(result.expiresAt).toEqual(new Date('2030-01-01T00:00:00Z'));
  });

  it('does nothing for an account that is already active', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue({ ...PENDING_ACCOUNT, status: 'ACTIVE' });

    const result = await makeService(mocks).request('buyer@sunrisepharma.local');

    // Re-issuing would replace a live code with one nobody asked for.
    expect(mocks.otp.issue).not.toHaveBeenCalled();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('answers identically for an unknown identifier', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(null);

    const result = await makeService(mocks).request('nobody@nowhere.local');

    expect(mocks.otp.issue).not.toHaveBeenCalled();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.devCode).toBeUndefined();
  });

  it('exposes the code only when the dev flag is on', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(PENDING_ACCOUNT);
    mocks.otp.issue.mockResolvedValue({ code: '222222', expiresAt: new Date() });
    mocks.config.authOtp.exposeInResponse = true;

    const result = await makeService(mocks).request('buyer@sunrisepharma.local');

    expect(result.devCode).toBe('222222');
  });
});

describe('ContactVerificationService.verify', () => {
  it('activates the account and records the email as verified', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(PENDING_ACCOUNT);
    mocks.otp.consume.mockResolvedValue({ id: 'c1', userId: 'user-1', tenantId: 'tenant-1' });

    const result = await makeService(mocks).verify('buyer@sunrisepharma.local', '123456');

    expect(result).toEqual({ userId: 'user-1', status: 'ACTIVE' });
    expect(mocks.otp.consume).toHaveBeenCalledWith({
      destination: 'buyer@sunrisepharma.local',
      purpose: 'VERIFY_CONTACT',
      code: '123456',
    });
    expect(mocks.txUser.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { status: 'ACTIVE', emailVerifiedAt: expect.any(Date) },
    });
  });

  it('stamps phoneVerifiedAt for a phone destination', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue({
      ...PENDING_ACCOUNT,
      email: null,
      phone: '+919876543210',
    });
    mocks.otp.consume.mockResolvedValue({ id: 'c1', userId: 'user-1', tenantId: 'tenant-1' });

    await makeService(mocks).verify('+919876543210', '123456');

    expect(mocks.txUser.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { status: 'ACTIVE', phoneVerifiedAt: expect.any(Date) },
    });
  });

  it('records the activation in the audit trail in the same transaction', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(PENDING_ACCOUNT);
    mocks.otp.consume.mockResolvedValue({ id: 'c1', userId: 'user-1', tenantId: 'tenant-1' });

    await makeService(mocks).verify('buyer@sunrisepharma.local', '123456');

    expect(mocks.audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'auth.verify.succeeded',
        entity: 'User',
        entityId: 'user-1',
        changes: { status: { from: 'PENDING_VERIFICATION', to: 'ACTIVE' } },
      }),
    );
  });

  it('rejects an identifier that cannot be canonicalised, before any lookup', async () => {
    const mocks = makeMocks();

    await expect(makeService(mocks).verify('   ', '123456')).rejects.toBeInstanceOf(OtpInvalidError);

    expect(mocks.prisma.user.findFirst).not.toHaveBeenCalled();
    expect(mocks.otp.consume).not.toHaveBeenCalled();
  });

  it('rejects an unknown account without touching the code', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      makeService(mocks).verify('nobody@nowhere.local', '123456'),
    ).rejects.toBeInstanceOf(OtpInvalidError);

    expect(mocks.otp.consume).not.toHaveBeenCalled();
  });

  it('rejects a challenge owned by another account, and does not activate anyone', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(PENDING_ACCOUNT);
    mocks.otp.consume.mockResolvedValue({ id: 'c1', userId: 'somebody-else', tenantId: 'tenant-1' });

    await expect(
      makeService(mocks).verify('buyer@sunrisepharma.local', '123456'),
    ).rejects.toBeInstanceOf(OtpInvalidError);

    expect(mocks.txUser.update).not.toHaveBeenCalled();
  });

  it('propagates a rejected code and never activates the account', async () => {
    const mocks = makeMocks();
    mocks.prisma.user.findFirst.mockResolvedValue(PENDING_ACCOUNT);
    mocks.otp.consume.mockRejectedValue(new OtpInvalidError());

    await expect(
      makeService(mocks).verify('buyer@sunrisepharma.local', '000000'),
    ).rejects.toBeInstanceOf(OtpInvalidError);

    expect(mocks.txUser.update).not.toHaveBeenCalled();
    expect(mocks.audit.recordInTransaction).not.toHaveBeenCalled();
  });
});
