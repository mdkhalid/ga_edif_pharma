import { Inject, Injectable } from '@nestjs/common';

import { OrganisationStatus, OrgType } from '@medichain/shared-types';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { UnitOfWork } from '../../../database/unit-of-work';
import { BusinessRuleViolationError, NotFoundError } from '../../../common/exceptions/domain.exception';
import { AuditService } from '../../audit';
import type { SubmitApplicationDto } from '../api/dto/onboarding.dto';

/**
 * Distributor onboarding and KYC review.
 *
 * Minimal Phase 1 slice: submit an organisation application (PENDING),
 * list the reviewer queue, approve to ACTIVE or reject to BLOCKED.
 * Every state change is audited inside the same transaction as the write.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
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
      const existing = await this.uow.lockById<{ id: string; status: string }>(
        tx,
        'organisation',
        id,
        tenantId,
      );
      if (!existing) throw new NotFoundError('Application not found.');
      if (existing.status !== OrganisationStatus.PENDING) {
        throw new BusinessRuleViolationError('Only PENDING applications can be approved.');
      }

      await tx.organisation.update({
        where: { id },
        data: {
          status: OrganisationStatus.ACTIVE,
          approvedAt: new Date(),
          approvedBy: actorId,
        },
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

      await tx.organisation.update({
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
