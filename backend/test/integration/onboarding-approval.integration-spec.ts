import { OrganisationStatus, SystemRole, UserStatus } from '@medichain/shared-types';

import { AppConfigService } from '../../src/config/app-config.service';
import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { UnitOfWork } from '../../src/database/unit-of-work';
import { AuditService } from '../../src/modules/audit/application/audit.service';
import { OnboardingService } from '../../src/modules/onboarding-kyc/application/onboarding.service';
import { testConfig } from '../support/config';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

/**
 * The onboarding half of the Phase 1 exit criteria:
 *
 *   "A new distributor completes onboarding and is approved end-to-end."
 *
 * "End-to-end" here means the applicant's journey as the backend can observe it:
 * an application is submitted, a reviewer approves it, the organisation becomes
 * orderable, and the organisation has an administrator who can be given access.
 * An approval that produced an ACTIVE organisation nobody could ever sign in to
 * would satisfy a status check and none of the intent.
 */

const REVIEWER_ID = '22222222-2222-4222-8222-222222222222';

describe('onboarding approval (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let onboarding: OnboardingService;
  let config: AppConfigService;
  let tenantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    config = testConfig({ APP_NAME: 'MediChain' });
    onboarding = new OnboardingService(prisma, new UnitOfWork(prisma), new AuditService(prisma), config);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Submits an application and returns the new organisation's id. */
  async function submitApplication(
    overrides: { email?: string; phone?: string; legalName?: string } = {},
  ): Promise<string> {
    const suffix = `${Date.now()}-${Math.random()}`;
    const submitted = await asTenantUser(tenantId, () =>
      onboarding.submit(
        tenantId,
        {
          type: 'DISTRIBUTOR',
          legalName: overrides.legalName ?? `Onboarding test ${suffix}`,
          ...(overrides.email !== undefined ? { email: overrides.email } : {}),
          ...(overrides.phone !== undefined ? { phone: overrides.phone } : {}),
        },
        REVIEWER_ID,
      ),
    );
    return submitted.id;
  }

  const approve = (organisationId: string) =>
    asTenantUser(tenantId, () => onboarding.approve(tenantId, organisationId, REVIEWER_ID));

  const organisationById = (id: string) =>
    asTenantUser(tenantId, async () =>
      prisma.organisation.findFirst({
        where: { id },
        select: { status: true, approvedAt: true, approvedBy: true },
      }),
    );

  const usersFor = (organisationId: string) =>
    asTenantUser(tenantId, async () =>
      prisma.user.findMany({
        where: { organisationId },
        select: {
          id: true,
          email: true,
          status: true,
          emailVerifiedAt: true,
          roles: { select: { role: { select: { code: true } } } },
        },
      }),
    );

  describe('approving an application', () => {
    it('activates the organisation and records the reviewer', async () => {
      const organisationId = await submitApplication();

      await approve(organisationId);

      const organisation = await organisationById(organisationId);
      expect(organisation?.status).toBe(OrganisationStatus.ACTIVE);
      expect(organisation?.approvedAt).not.toBeNull();
      expect(organisation?.approvedBy).toBe(REVIEWER_ID);
    });

    it('gives the organisation an administrator holding the buyer role', async () => {
      const organisationId = await submitApplication({ email: `buyer-${Date.now()}@example.test` });

      await approve(organisationId);

      const users = await usersFor(organisationId);
      expect(users).toHaveLength(1);
      expect(users[0]?.roles.map((grant) => grant.role.code)).toContain(SystemRole.BUYER_ADMIN);
    });

    it('creates the account unclaimed, so no session can exist before it is proven', async () => {
      // The invite pattern: nobody — not even the approver — holds a credential
      // for this account. It becomes usable through the reset flow, which proves
      // control of the address first.
      const organisationId = await submitApplication({ email: `unclaimed-${Date.now()}@example.test` });

      await approve(organisationId);

      const users = await usersFor(organisationId);
      expect(users[0]?.status).toBe(UserStatus.PENDING_VERIFICATION);
      expect(users[0]?.emailVerifiedAt).toBeNull();
    });

    it('addresses the account using the organisation, pending a real contact name', async () => {
      const legalName = `Named Distributor ${Date.now()}`;
      const organisationId = await submitApplication({
        legalName,
        email: `named-${Date.now()}@example.test`,
      });

      await approve(organisationId);

      const users = await asTenantUser(tenantId, async () =>
        prisma.user.findMany({
          where: { organisationId },
          select: { fullName: true },
        }),
      );
      expect(users[0]?.fullName).toBe(legalName);
    });
  });

  describe('the awkward cases', () => {
    it('refuses a second approval, so an organisation cannot be re-provisioned', async () => {
      const organisationId = await submitApplication({ email: `twice-${Date.now()}@example.test` });
      await approve(organisationId);

      await expect(approve(organisationId)).rejects.toThrow(/only pending applications/i);

      // And crucially: no second account.
      expect(await usersFor(organisationId)).toHaveLength(1);
    });

    it('does not create a second account for contact details that already have one', async () => {
      // The applicant is authenticated when they submit, so their own account
      // frequently already exists. Two accounts for one address would be an
      // access-control problem, not a convenience.
      const email = `shared-${Date.now()}@example.test`;

      const first = await submitApplication({ email });
      await approve(first);

      const second = await submitApplication({ email });
      await approve(second);

      const users = await asTenantUser(tenantId, async () =>
        prisma.user.findMany({ where: { email }, select: { id: true } }),
      );
      expect(users).toHaveLength(1);
    });

    it('approves an application that carries no contact details, without inventing an account', async () => {
      // `email` and `phone` are optional on the application. Refusing the
      // approval would punish the reviewer for the applicant's omission.
      const organisationId = await submitApplication();

      await expect(approve(organisationId)).resolves.toBeUndefined();

      expect((await organisationById(organisationId))?.status).toBe(OrganisationStatus.ACTIVE);
      expect(await usersFor(organisationId)).toHaveLength(0);
    });
  });
});
