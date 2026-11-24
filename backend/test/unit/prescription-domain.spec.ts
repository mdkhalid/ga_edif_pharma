import {
  assessPrescriptionUsability,
  canVerify,
  effectiveStatus,
  requiresPrescription,
  type Prescription,
} from '../../src/modules/prescriptions/domain/prescription.types';

function makeRx(overrides: Partial<Prescription> = {}): Prescription {
  const now = new Date('2026-06-01T00:00:00Z');
  return {
    id: 'rx-1',
    tenantId: 't1',
    organisationId: 'o1',
    patientRef: null,
    doctorName: null,
    referenceNumber: null,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: new Date('2026-12-31T23:59:59Z'),
    status: 'VERIFIED',
    attachmentKey: null,
    attachmentMimeType: null,
    verifiedBy: 'actor',
    verifiedAt: now,
    rejectionReason: null,
    dispensingCount: 0,
    maxDispensings: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('prescription domain rules', () => {
  it('requiresPrescription is true for H/H1/X/Narcotic and false for OTC', () => {
    expect(requiresPrescription('H')).toBe(true);
    expect(requiresPrescription('H1')).toBe(true);
    expect(requiresPrescription('X')).toBe(true);
    expect(requiresPrescription('NARCOTIC')).toBe(true);
    expect(requiresPrescription('OTC')).toBe(false);
    expect(requiresPrescription('h1')).toBe(true);
  });

  it('assessPrescriptionUsability allows a verified in-date prescription', () => {
    const rx = makeRx();
    const now = new Date('2026-06-15T00:00:00Z');
    expect(assessPrescriptionUsability(rx, now)).toEqual({ usable: true });
  });

  it('rejects a pending prescription', () => {
    const rx = makeRx({ status: 'PENDING_VERIFICATION' });
    const res = assessPrescriptionUsability(rx, new Date('2026-06-15T00:00:00Z'));
    expect(res.usable).toBe(false);
  });

  it('rejects an expired prescription', () => {
    const rx = makeRx({ validTo: new Date('2026-05-01T00:00:00Z') });
    const res = assessPrescriptionUsability(rx, new Date('2026-06-15T00:00:00Z'));
    expect(res.usable).toBe(false);
  });

  it('rejects a not-yet-valid prescription', () => {
    const rx = makeRx({ validFrom: new Date('2026-07-01T00:00:00Z') });
    const res = assessPrescriptionUsability(rx, new Date('2026-06-15T00:00:00Z'));
    expect(res.usable).toBe(false);
  });

  it('rejects when dispensing cap reached', () => {
    const rx = makeRx({ maxDispensings: 2, dispensingCount: 2 });
    const res = assessPrescriptionUsability(rx, new Date('2026-06-15T00:00:00Z'));
    expect(res.usable).toBe(false);
  });

  it('canVerify only for pending', () => {
    expect(canVerify(makeRx({ status: 'PENDING_VERIFICATION' }))).toBe(true);
    expect(canVerify(makeRx({ status: 'VERIFIED' }))).toBe(false);
  });

  it('effectiveStatus derives EXPIRED for lapsed verified prescription', () => {
    const rx = makeRx({ validTo: new Date('2026-05-01T00:00:00Z') });
    expect(effectiveStatus(rx, new Date('2026-06-15T00:00:00Z'))).toBe('EXPIRED');
  });
});
