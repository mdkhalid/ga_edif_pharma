import { Injectable } from '@nestjs/common';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { Inject } from '@nestjs/common';
import type { PrescriptionRepository } from '../application/prescription.repository.port';
import type { Prescription, PrescriptionStatus } from '../domain/prescription.types';

/**
 * Prisma adapter for `PrescriptionRepository`. Maps Prisma rows to the domain
 * `Prescription` shape. Tenant scoping is injected by the extension, so the
 * adapter never adds `tenantId` to a `where` by hand — it relies on the
 * extended client.
 */
@Injectable()
export class PrescriptionRepositoryPrisma implements PrescriptionRepository {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async create(input: {
    tenantId: string;
    organisationId: string;
    patientRef: string | null;
    doctorName: string | null;
    referenceNumber: string | null;
    validFrom: Date;
    validTo: Date | null;
    attachmentKey: string | null;
    attachmentMimeType: string | null;
    maxDispensings: number;
  }): Promise<Prescription> {
    const row = await this.prisma.prescription.create({
      data: {
        tenantId: input.tenantId,
        organisationId: input.organisationId,
        patientRef: input.patientRef,
        doctorName: input.doctorName,
        referenceNumber: input.referenceNumber,
        validFrom: input.validFrom,
        validTo: input.validTo,
        attachmentKey: input.attachmentKey,
        attachmentMimeType: input.attachmentMimeType,
        maxDispensings: input.maxDispensings,
        status: 'PENDING_VERIFICATION',
      },
    });
    return this.toDomain(row);
  }

  async findById(_tenantId: string, id: string): Promise<Prescription | null> {
    const row = await this.prisma.prescription.findFirst({ where: { id } });
    if (!row) return null;
    return this.toDomain(row);
  }

  async list(
    _tenantId: string,
    filters: { organisationId?: string | null; status?: PrescriptionStatus | null; page: number; pageSize: number },
  ): Promise<{ rows: Prescription[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filters.organisationId) where.organisationId = filters.organisationId;
    if (filters.status) where.status = filters.status;

    const [rows, total] = await Promise.all([
      this.prisma.prescription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.prescription.count({ where }),
    ]);
    return { rows: rows.map((r) => this.toDomain(r)), total };
  }

  async updateStatus(
    _tenantId: string,
    id: string,
    patch: {
      status: PrescriptionStatus;
      verifiedBy?: string | null;
      verifiedAt?: Date | null;
      rejectionReason?: string | null;
      dispensingCount?: number;
    },
  ): Promise<void> {
    await this.prisma.prescription.updateMany({
      where: { id },
      data: {
        status: patch.status,
        verifiedBy: patch.verifiedBy ?? undefined,
        verifiedAt: patch.verifiedAt ?? undefined,
        rejectionReason: patch.rejectionReason ?? undefined,
        dispensingCount: patch.dispensingCount ?? undefined,
      },
    });
  }

  private toDomain(row: {
    id: string;
    tenantId: string;
    organisationId: string;
    patientRef: string | null;
    doctorName: string | null;
    referenceNumber: string | null;
    validFrom: Date;
    validTo: Date | null;
    status: string;
    attachmentKey: string | null;
    attachmentMimeType: string | null;
    verifiedBy: string | null;
    verifiedAt: Date | null;
    rejectionReason: string | null;
    dispensingCount: number;
    maxDispensings: number;
    createdAt: Date;
    updatedAt: Date;
  }): Prescription {
    return {
      id: row.id,
      tenantId: row.tenantId,
      organisationId: row.organisationId,
      patientRef: row.patientRef,
      doctorName: row.doctorName,
      referenceNumber: row.referenceNumber,
      validFrom: row.validFrom,
      validTo: row.validTo,
      status: row.status as PrescriptionStatus,
      attachmentKey: row.attachmentKey,
      attachmentMimeType: row.attachmentMimeType,
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt,
      rejectionReason: row.rejectionReason,
      dispensingCount: row.dispensingCount,
      maxDispensings: row.maxDispensings,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
