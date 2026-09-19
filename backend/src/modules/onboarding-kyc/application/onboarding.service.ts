import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

import { OrganisationStatus, OrgType, SystemRole, UserStatus } from '@medichain/shared-types';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { UnitOfWork, type TransactionClient } from '../../../database/unit-of-work';
import { AppConfigService } from '../../../config/app-config.service';
import { BusinessRuleViolationError, NotFoundError } from '../../../common/exceptions/domain.exception';
import { AuditService } from '../../audit';
import type { SubmitApplicationDto } from '../api/dto/onboarding.dto';

/**
 * Distributor onboarding and KYC review.
 *
 * Phase 1 slice: submit an organisation application (PENDING), list the reviewer
 * queue, approve to ACTIVE or reject to BLOCKED — and, on approval, provision
 * the organisation's first administrator. Every state change is audited inside
 * the same transaction as the write.
 *
 * ## Why approval provisions a user
 *
 * "Approved" is a promise that this distributor can now order, and an
 * organisation with nobody able to sign in cannot. Creating the account here
 * rather than leaving it to a separate step is what makes approval mean
 * something.
 *
 * The account is created `PENDING_VERIFICATION` with a password nobody knows —
 * 32 random bytes, hashed. That is deliberate and it is the invite pattern:
 *
 *   - Nobody, including the approver, ever holds a credential for another
 *     person's account. A generated password would have to be transmitted, and
 *     transmitted credentials leak.
 *   - The buyer sets their own password through the existing reset flow, which
 *     proves control of the mailbox before any sign-in is possible. So the
 *     account cannot be used until its owner claims it, and no new endpoint was
 *     needed to achieve that.
 *
 * `PENDING_VERIFICATION` rather than `ACTIVE` because the address on the
 * application has not been proven to belong to whoever reads it; approval vets
 * the *organisation*, not the mailbox. The existing contact-verification flow
 * activates the account.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async submit(tenantId: string, dto: SubmitApplicationDto, actorId?: string): Promise<{ id: string }> {
    const org = await this.uow.transaction(async (tx) => {
      const created = await tx.organisation.create({
        data: {
          tenantId,
          type: dto.type as OrgType,
          status: OrganisationStatus.PENDING,
          legalName: dto.legalName,
          tradeName: dto.tradeName ?? null,
          drugLicenceNo: dto.drugLicenceNo ?? null,
          gstin: dto.gstin ?? null,
          pan: dto.pan ?? null,
          stateCode: dto.stateCode ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
        },
        select: { id: true },
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'onboarding.application.submitted',
        entity: 'Organisation',
        entityId: created.id,
        actorId: actorId ?? null,
        metadata: { legalName: dto.legalName, type: dto.type },
      });

      return created;
    });

    return { id: org.id };
  }

  async listPending(_tenantId: string): Promise<
    Array<{ id: string; legalName: string; type: string; createdAt: Date }>
  > {
    return this.prisma.organisation.findMany({
      where: { status: OrganisationStatus.PENDING },
      select: { id: true, legalName: true, type: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async approve(tenantId: string, id: string, actorId: string, reason?: string): Promise<void> {
    await this.uow.transaction(async (tx) => {
      // Column names are the DATABASE's, not Prisma's: `lockById` issues raw SQL
      // (`SELECT * … FOR UPDATE`), so it returns `legal_name`, not `legalName`.
      // Reading the camelCase name here yields `undefined`, which fails later
      // and elsewhere — as a missing required field inside `user.create`.
      const existing = await this.uow.lockById<{
        id: string;
        status: string;
        legal_name: string;
        trade_name: string | null;
        email: string | null;
        phone: string | null;
      }>(tx, 'organisation', id, tenantId);
      if (!existing) throw new NotFoundError('Application not found.');
      if (existing.status !== OrganisationStatus.PENDING) {
        throw new BusinessRuleViolationError('Only PENDING applications can be approved.');
      }

      // updateMany, not update: the scoping extension adds `tenantId` to the
      // filter, and Prisma rejects a non-unique `where` on update/findUnique.
      // Ownership is already proven by the row lock above.
      await tx.organisation.updateMany({
        where: { id },
        data: {
          status: OrganisationStatus.ACTIVE,
          approvedAt: new Date(),
          approvedBy: actorId,
        },
      });

      await this.provisionFirstAdministrator(tx, tenantId, {
        organisationId: id,
        legalName: existing.legal_name,
        tradeName: existing.trade_name,
        email: existing.email,
        phone: existing.phone,
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'onboarding.application.approved',
        entity: 'Organisation',
        entityId: id,
        actorId,
        changes: {
          status: { from: OrganisationStatus.PENDING, to: OrganisationStatus.ACTIVE },
        },
        metadata: reason ? { reason } : undefined,
      });
    });
  }

  /**
   * Creates the organisation's first administrator, inside the approval
   * transaction so an approved organisation always has somebody who can be
   * given access.
   *
   * Two cases are deliberately *not* errors:
   *
   *   - **No contact identifier.** `email` and `phone` are optional on an
   *     application. Without either there is nothing to attach an account to,
   *     so the approval stands and the gap is logged. Refusing the approval
   *     would punish the reviewer for the applicant's omission.
   *   - **The identifier already has an account in this tenant.** The applicant
   *     is authenticated when they submit, so their own account often exists.
   *     Creating a second one with the same address would produce two accounts
   *     for one person — an access-control problem, not a convenience.
   */
  private async provisionFirstAdministrator(
    tx: TransactionClient,
    tenantId: string,
    organisation: {
      organisationId: string;
      legalName: string;
      tradeName: string | null;
      email: string | null;
      phone: string | null;
    },
  ): Promise<void> {
    const email = organisation.email?.trim().toLowerCase() ?? null;
    const phone = organisation.phone?.trim() ?? null;

    if (email === null && phone === null) {
      this.logger.warn(
        `Organisation ${organisation.organisationId} was approved with no email or phone; ` +
          'no administrator account was created.',
      );
      return;
    }

    const existingUser = await tx.user.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        ...(email !== null ? { email } : { phone }),
      },
      select: { id: true },
    });

    if (existingUser !== null) {
      this.logger.warn(
        `Organisation ${organisation.organisationId} was approved, but an account already ` +
          'exists for its contact details; no second account was created.',
      );
      return;
    }

    const role = await tx.role.findFirst({
      where: { code: SystemRole.BUYER_ADMIN, tenantId },
      select: { id: true },
    });

    if (role === null) {
      // An account with no role would be able to sign in and do nothing, which
      // is a worse outcome than a loud failure: nobody would know why the buyer
      // sees an empty application.
      throw new BusinessRuleViolationError(
        `The ${SystemRole.BUYER_ADMIN} role is not configured for this tenant, so an ` +
          'administrator cannot be given access. Seed the roles, then approve again.',
      );
    }

    // 32 random bytes, hashed. Nobody knows this value, which is the point:
    // the account is claimed through the password-reset flow, which proves
    // control of the address before a session can exist.
    const passwordHash = await argon2.hash(randomBytes(32).toString('base64url'), {
      type: argon2.argon2id,
      memoryCost: this.config.argon2.memoryCost,
      timeCost: this.config.argon2.timeCost,
      parallelism: this.config.argon2.parallelism,
    });

    const user = await tx.user.create({
      data: {
        tenantId,
        organisationId: organisation.organisationId,
        email,
        phone,
        // The application collects an organisation, not a person. Using its name
        // is a placeholder, and it is visible in the admin UI so it is obvious
        // that a real name has yet to arrive.
        fullName: organisation.tradeName ?? organisation.legalName,
        passwordHash,
        status: UserStatus.PENDING_VERIFICATION,
      },
      select: { id: true },
    });

    await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });

    await this.audit.recordInTransaction(tx, {
      tenantId,
      action: 'onboarding.administrator.provisioned',
      entity: 'User',
      entityId: user.id,
      actorId: null,
      actorEmail: email,
      metadata: { organisationId: organisation.organisationId, role: SystemRole.BUYER_ADMIN },
    });
  }

  async reject(tenantId: string, id: string, actorId: string, reason?: string): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const existing = await this.uow.lockById<{ id: string; status: string }>(
        tx,
        'organisation',
        id,
        tenantId,
      );
      if (!existing) throw new NotFoundError('Application not found.');
      if (existing.status !== OrganisationStatus.PENDING) {
        throw new BusinessRuleViolationError('Only PENDING applications can be rejected.');
      }

      // updateMany for the same Prisma-unique-where reason as in approve.
      await tx.organisation.updateMany({
        where: { id },
        data: { status: OrganisationStatus.BLOCKED },
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'onboarding.application.rejected',
        entity: 'Organisation',
        entityId: id,
        actorId,
        changes: {
          status: { from: OrganisationStatus.PENDING, to: OrganisationStatus.BLOCKED },
        },
        metadata: reason ? { reason } : undefined,
      });
    });
  }
}
