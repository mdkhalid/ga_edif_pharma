/**
 * Prescription domain types (P8).
 *
 * A prescription is the document a buyer (doctor/patient) presents to buy a
 * scheduled medicine. Selling a schedule H/H1/X drug without a *verified*
 * prescription is a criminal offence in India, so the control is enforced
 * server-side in the order transaction — see `OrderService.place`.
 *
 * ## Status lifecycle
 *
 *   PENDING_VERIFICATION  → VERIFIED  (pharmacist approves)
 *   PENDING_VERIFICATION  → REJECTED  (pharmacist rejects, with a reason)
 *   VERIFIED              → EXPIRED   (validity window lapsed, derived — not stored)
 *
 * A prescription is never "un-verified" once approved: an audit row records
 * who verified it and when, and re-verification requires a new document.
 */

/** Regulatory schedules that require a prescription. OTC does not. */
export const PRESCRIPTION_REQUIRED_SCHEDULES: ReadonlySet<string> = new Set([
  'H',
  'H1',
  'X',
  'NARCOTIC',
]);

/** Returns true when a product's schedule legally requires a prescription. */
export function requiresPrescription(schedule: string): boolean {
  return PRESCRIPTION_REQUIRED_SCHEDULES.has(schedule.toUpperCase());
}

export type PrescriptionStatus =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

/** Verification outcome recorded by the pharmacist. */
export type VerificationDecision = 'APPROVE' | 'REJECT';

export interface Prescription {
  readonly id: string;
  readonly tenantId: string;
  /** Buying organisation that owns the prescription (the patient's pharmacy/distributor). */
  readonly organisationId: string;
  /** Optional patient identifier (free text — name or code). */
  readonly patientRef: string | null;
  readonly doctorName: string | null;
  /** Reference number printed on the prescription (doctor's own, or a generated one). */
  readonly referenceNumber: string | null;
  /** First day the prescription is valid (inclusive). */
  readonly validFrom: Date;
  /** Last day the prescription is valid (inclusive). Null = no expiry. */
  readonly validTo: Date | null;
  readonly status: PrescriptionStatus;
  /** Storage key / URL of the uploaded document. Null until uploaded. */
  readonly attachmentKey: string | null;
  readonly attachmentMimeType: string | null;
  readonly verifiedBy: string | null;
  readonly verifiedAt: Date | null;
  readonly rejectionReason: string | null;
  /** How many times this prescription has been dispensed against. */
  readonly dispensingCount: number;
  /** Configurable cap on re-use (Phase 3). 0 = single use. */
  readonly maxDispensings: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePrescriptionInput {
  tenantId: string;
  organisationId: string;
  patientRef?: string | null;
  doctorName?: string | null;
  referenceNumber?: string | null;
  validFrom?: Date;
  validTo?: Date | null;
  attachmentKey?: string | null;
  attachmentMimeType?: string | null;
  maxDispensings?: number;
}

export interface VerifyPrescriptionInput {
  decision: VerificationDecision;
  reason?: string | null;
}

/**
 * Pure check: is this prescription usable for dispensing right now?
 * Returns `{ usable: true }` or `{ usable: false, reason }` naming the blocker.
 *
 * `now` is injected so callers (and tests) control time.
 */
export function assessPrescriptionUsability(
  prescription: Prescription,
  now: Date,
): { usable: true } | { usable: false; reason: string } {
  if (prescription.status === 'PENDING_VERIFICATION') {
    return { usable: false, reason: 'Prescription has not been verified yet.' };
  }
  if (prescription.status === 'REJECTED') {
    return { usable: false, reason: 'Prescription was rejected.' };
  }
  if (prescription.status === 'EXPIRED') {
    return { usable: false, reason: 'Prescription has expired.' };
  }
  // VERIFIED — check validity window and dispensing cap.
  if (now < prescription.validFrom) {
    return { usable: false, reason: 'Prescription is not yet valid.' };
  }
  if (prescription.validTo && now > prescription.validTo) {
    return { usable: false, reason: 'Prescription has expired.' };
  }
  if (
    prescription.maxDispensings > 0 &&
    prescription.dispensingCount >= prescription.maxDispensings
  ) {
    return {
      usable: false,
      reason: 'Prescription has reached its maximum number of dispensings.',
    };
  }
  return { usable: true };
}

/**
 * Derives the effective status, treating a verified prescription whose validity
 * window has lapsed as EXPIRED. The stored status stays VERIFIED; this is a
 * read-time derivation so the audit trail is never rewritten by the clock.
 */
export function effectiveStatus(prescription: Prescription, now: Date): PrescriptionStatus {
  if (prescription.status !== 'VERIFIED') return prescription.status;
  if (prescription.validTo && now > prescription.validTo) return 'EXPIRED';
  if (now < prescription.validFrom) return 'PENDING_VERIFICATION';
  return 'VERIFIED';
}

/** Whether a verification decision can be applied to the current status. */
export function canVerify(prescription: Prescription): boolean {
  return prescription.status === 'PENDING_VERIFICATION';
}
