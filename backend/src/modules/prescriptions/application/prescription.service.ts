import { Inject, Injectable } from '@nestjs/common';

import {
  BusinessRuleViolationError,
  ForbiddenError,
  NotFoundError,
} from '../../../common/exceptions/domain.exception';
import { AuditService } from '../../audit';
import { PRESCRIPTION_REPOSITORY, type PrescriptionRepository } from './prescription.repository.port';
import {
  assessPrescriptionUsability,
  canVerify,
  type Prescription,
  type PrescriptionStatus,
  type VerifyPrescriptionInput,
} from '../domain/prescription.types';

export interface CreatePrescriptionDto {
  organisationId: string;
  patientRef?: string | null;
  doctorName?: string | null;
  referenceNumber?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  attachmentKey?: string | null;
  attachmentMimeType?: string | null;
  maxDispensings?: number;
}

export interface ListPrescriptionsQuery {
  organisationId?: string | null;
  status?: string | null;
  page?: number;
  pageSize?: number;
}

/**
 * Prescriptions bounded context (P8).
 *
 * Upload (metadata + storage key), pharmacist verification, and the
 * server-side gate that blocks ordering scheduled medicines without a
 * verified, in-date prescription. The gate itself lives in
 * `OrderService.place`, which calls `assertUsableForOrder`.
 */
@Injectable()
export class PrescriptionService {
  constructor(
    private readonly audit: AuditService,
    @Inject(PRESCRIPTION_REPOSITORY) private readonly repo: PrescriptionRepository,
  ) {}

  async create(
    tenantId: string,
    actorId: string,
    dto: CreatePrescriptionDto,
  ): Promise<{ id: string }> {
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (validTo && validTo < validFrom) {
      throw new BusinessRuleViolationError('validTo must be on or after validFrom.');
    }

    const created = await this.repo.create({
      tenantId,
      organisationId: dto.organisationId,
      patientRef: dto.patientRef ?? null,
      doctorName: dto.doctorName ?? null,
      referenceNumber: dto.referenceNumber ?? null,
      validFrom,
      validTo,
      attachmentKey: dto.attachmentKey ?? null,
      attachmentMimeType: dto.attachmentMimeType ?? null,
      maxDispensings: dto.maxDispensings ?? 0,
    });

    await this.audit.record({
      tenantId,
      action: 'prescription.created',
      entity: 'Prescription',
      entityId: created.id,
      actorId,
      metadata: { organisationId: dto.organisationId },
    });

    return { id: created.id };
  }

  async getById(
    tenantId: string,
    id: string,
    organisationId: string | null,
    staff: boolean,
  ): Promise<Prescription | null> {
    const row = await this.repo.findById(tenantId, id);
    if (!row) return null;
    if (!staff && organisationId !== row.organisationId) {
      throw new ForbiddenError('This prescription belongs to another organisation.');
    }
    return row;
  }

  async list(
    tenantId: string,
    organisationId: string | null,
    staff: boolean,
    query: ListPrescriptionsQuery,
  ): Promise<{
    data: Prescription[];
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 20;
    const orgFilter = staff ? (query.organisationId ?? null) : organisationId;
    const status = (query.status as PrescriptionStatus | null) ?? null;

    const { rows, total } = await this.repo.list(tenantId, {
      organisationId: orgFilter,
      status,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;
    return {
      data: rows,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async verify(
    tenantId: string,
    id: string,
    actorId: string,
    dto: VerifyPrescriptionInput,
  ): Promise<void> {
    const rx = await this.repo.findById(tenantId, id);
    if (!rx) throw new NotFoundError('Prescription not found.');
    if (!canVerify(rx)) {
      throw new BusinessRuleViolationError(
        `Prescription cannot be verified from status ${rx.status}.`,
      );
    }

    if (dto.decision === 'APPROVE') {
      await this.repo.updateStatus(tenantId, id, {
        status: 'VERIFIED',
        verifiedBy: actorId,
        verifiedAt: new Date(),
        rejectionReason: null,
      });
      await this.audit.record({
        tenantId,
        action: 'prescription.verified',
        entity: 'Prescription',
        entityId: id,
        actorId,
      });
    } else {
      if (!dto.reason) {
        throw new BusinessRuleViolationError('A rejection reason is required.');
      }
      await this.repo.updateStatus(tenantId, id, {
        status: 'REJECTED',
        verifiedBy: actorId,
        verifiedAt: new Date(),
        rejectionReason: dto.reason,
      });
      await this.audit.record({
        tenantId,
        action: 'prescription.rejected',
        entity: 'Prescription',
        entityId: id,
        actorId,
        metadata: { reason: dto.reason },
      });
    }
  }

  /**
   * Server-side gate used by OrderService.place: throws if the prescription is
   * not usable for dispensing. Returns the prescription so the caller can link
   * it to the order. Also increments the dispensing counter.
   */
  async assertUsableForOrder(
    tenantId: string,
    organisationId: string,
    prescriptionId: string,
  ): Promise<Prescription> {
    const rx = await this.repo.findById(tenantId, prescriptionId);
    if (!rx) throw new NotFoundError('Prescription not found.');
    if (rx.organisationId !== organisationId) {
      throw new ForbiddenError('This prescription belongs to another organisation.');
    }
    const assessment = assessPrescriptionUsability(rx, new Date());
    if (!assessment.usable) {
      throw new BusinessRuleViolationError(assessment.reason);
    }
    return rx;
  }

  async incrementDispensing(tenantId: string, prescriptionId: string): Promise<void> {
    const rx = await this.repo.findById(tenantId, prescriptionId);
    if (!rx) return;
    await this.repo.updateStatus(tenantId, prescriptionId, {
      status: rx.status,
      dispensingCount: rx.dispensingCount + 1,
    });
  }
}
