import type { OffsetPaginated } from './common';

/**
 * Prescription shapes as they cross the wire (P8 / admin queue).
 *
 * The server's domain object holds `Date`s and `Money`; neither survives JSON.
 * These are the string-serialised forms both the API and its consumers compile
 * against — a fourth hand-written copy in the admin portal would drift.
 */
export type PrescriptionStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export type VerificationDecision = 'APPROVE' | 'REJECT';

export interface PrescriptionSummary {
  readonly id: string;
  readonly organisationId: string;
  readonly patientRef: string | null;
  readonly doctorName: string | null;
  readonly referenceNumber: string | null;
  /** ISO 8601. */
  readonly validFrom: string;
  /** ISO 8601; null means the prescription has no expiry. */
  readonly validTo: string | null;
  readonly status: PrescriptionStatus;
  readonly attachmentKey: string | null;
  readonly attachmentMimeType: string | null;
  readonly verifiedBy: string | null;
  /** ISO 8601. */
  readonly verifiedAt: string | null;
  readonly rejectionReason: string | null;
  readonly dispensingCount: number;
  readonly maxDispensings: number;
  /** ISO 8601. */
  readonly createdAt: string;
  /** ISO 8601. */
  readonly updatedAt: string;
}

export type PrescriptionPage = OffsetPaginated<PrescriptionSummary>;

export interface PrescriptionVerificationResult {
  readonly id: string;
}
