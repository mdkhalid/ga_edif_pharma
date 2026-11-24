import type { Prescription, PrescriptionStatus } from '../domain/prescription.types';

export const PRESCRIPTION_REPOSITORY = Symbol('PrescriptionRepository');

/**
 * Port for prescription persistence. Mirrors the hexagonal pattern used by
 * `PricingRepository` / `SchemeRepository`: the application service depends
 * on this interface, and the Prisma adapter (infra) implements it.
 *
 * All methods are tenant-scoped by construction — the adapter injects
 * `tenantId` into every query. The service never filters on `tenantId` by
 * hand (that is the scoping extension's job, and duplicating it would create
 * a second source of tenant isolation).
 */
export interface PrescriptionRepository {
  create(input: {
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
  }): Promise<Prescription>;

  findById(tenantId: string, id: string): Promise<Prescription | null>;

  /** List prescriptions for an organisation (buyer view) or all (staff view). */
  list(tenantId: string, filters: {
    organisationId?: string | null;
    status?: PrescriptionStatus | null;
    page: number;
    pageSize: number;
  }): Promise<{ rows: Prescription[]; total: number }>;

  updateStatus(
    tenantId: string,
    id: string,
    patch: {
      status: PrescriptionStatus;
      verifiedBy?: string | null;
      verifiedAt?: Date | null;
      rejectionReason?: string | null;
      dispensingCount?: number;
    },
  ): Promise<void>;
}
