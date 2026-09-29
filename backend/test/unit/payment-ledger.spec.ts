import { createHmac } from 'crypto';
import { Money } from '../../src/modules/pricing/domain/money.vo';
import {
  PaymentLedger,
  PaymentStateTransitionError,
  DuplicateIdempotencyKeyError,
  AppendPaymentEntryInput,
  canTransition,
  statusForEvent,
} from '../../src/modules/payments/domain/payment-ledger';
import { verifyWebhookSignature, InvalidWebhookSignatureError } from '../../src/modules/payments/domain/webhook-signature';

const TENANT = 'T1';
const PAYMENT = 'PAY-001';

function entry(
  id: string,
  type: AppendPaymentEntryInput['type'],
  amount: number = 1000,
  idempotencyKey?: string,
): AppendPaymentEntryInput {
  return {
    id,
    tenantId: TENANT,
    paymentId: PAYMENT,
    type,
    amount: new Money(amount),
    idempotencyKey,
    createdAt: new Date('2026-01-01'),
  };
}

describe('PaymentLedger — state machine', () => {
  it('starts with null status for unknown payment', () => {
    const ledger = new PaymentLedger();
    expect(ledger.currentStatus(PAYMENT)).toBeNull();
  });

  it('transitions PENDING → PROCESSING → AUTHORIZED → CAPTURED', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED'))
      .append(entry('E2', 'GATEWAY_REQUESTED'))
      .append(entry('E3', 'GATEWAY_AUTHORIZED'))
      .append(entry('E4', 'GATEWAY_CAPTURED'));

    expect(ledger.currentStatus(PAYMENT)).toBe('CAPTURED');
  });

  it('allows PENDING → PROCESSING → FAILED', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED'))
      .append(entry('E2', 'GATEWAY_REQUESTED'))
      .append(entry('E3', 'GATEWAY_FAILED'));

    expect(ledger.currentStatus(PAYMENT)).toBe('FAILED');
  });

  it('allows FAILED → PENDING (retry)', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED'))
      .append(entry('E2', 'GATEWAY_REQUESTED'))
      .append(entry('E3', 'GATEWAY_FAILED'))
      .append(entry('E4', 'INTENT_CREATED'));

    expect(ledger.currentStatus(PAYMENT)).toBe('PENDING');
  });

  it('throws on invalid transition PENDING → CAPTURED', () => {
    const ledger = new PaymentLedger().append(entry('E1', 'INTENT_CREATED'));
    expect(() => ledger.append(entry('E2', 'GATEWAY_CAPTURED'))).toThrow(PaymentStateTransitionError);
  });

  it('throws on invalid transition CAPTURED → PROCESSING', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED'))
      .append(entry('E2', 'GATEWAY_REQUESTED'))
      .append(entry('E3', 'GATEWAY_AUTHORIZED'))
      .append(entry('E4', 'GATEWAY_CAPTURED'));
    expect(() => ledger.append(entry('E5', 'GATEWAY_REQUESTED'))).toThrow(PaymentStateTransitionError);
  });

  it('allows CAPTURED → REFUNDED', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED'))
      .append(entry('E2', 'GATEWAY_REQUESTED'))
      .append(entry('E3', 'GATEWAY_AUTHORIZED'))
      .append(entry('E4', 'GATEWAY_CAPTURED'))
      .append(entry('E5', 'REFUND_INITIATED'))
      .append(entry('E6', 'REFUND_COMPLETED'));

    expect(ledger.currentStatus(PAYMENT)).toBe('REFUNDED');
  });

  it('REFUNDED is terminal — no further transitions', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED'))
      .append(entry('E2', 'GATEWAY_REQUESTED'))
      .append(entry('E3', 'GATEWAY_AUTHORIZED'))
      .append(entry('E4', 'GATEWAY_CAPTURED'))
      .append(entry('E5', 'REFUND_INITIATED'))
      .append(entry('E6', 'REFUND_COMPLETED'));
    expect(() => ledger.append(entry('E7', 'GATEWAY_REQUESTED'))).toThrow(PaymentStateTransitionError);
  });
});

describe('canTransition', () => {
  it('returns true for valid transitions', () => {
    expect(canTransition('PENDING', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'AUTHORIZED')).toBe(true);
    expect(canTransition('AUTHORIZED', 'CAPTURED')).toBe(true);
    expect(canTransition('CAPTURED', 'REFUNDED')).toBe(true);
  });

  it('returns false for invalid transitions', () => {
    expect(canTransition('PENDING', 'CAPTURED')).toBe(false);
    expect(canTransition('CAPTURED', 'PROCESSING')).toBe(false);
    expect(canTransition('REFUNDED', 'PENDING')).toBe(false);
    expect(canTransition('CANCELLED', 'PROCESSING')).toBe(false);
  });

  it('allows CAPTURED → CAPTURED (refund initiation)', () => {
    expect(canTransition('CAPTURED', 'CAPTURED')).toBe(true);
  });
});

describe('statusForEvent', () => {
  it('maps each event type to the correct status', () => {
    expect(statusForEvent('INTENT_CREATED')).toBe('PENDING');
    expect(statusForEvent('GATEWAY_REQUESTED')).toBe('PROCESSING');
    expect(statusForEvent('GATEWAY_AUTHORIZED')).toBe('AUTHORIZED');
    expect(statusForEvent('GATEWAY_CAPTURED')).toBe('CAPTURED');
    expect(statusForEvent('GATEWAY_FAILED')).toBe('FAILED');
    expect(statusForEvent('REFUND_COMPLETED')).toBe('REFUNDED');
    expect(statusForEvent('CANCELLED')).toBe('CANCELLED');
  });
});

describe('PaymentLedger — idempotency', () => {
  it('accepts entries with unique idempotency keys', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED', 1000, 'idem-1'))
      .append(entry('E2', 'GATEWAY_REQUESTED', 1000, 'idem-2'));
    expect(ledger.verifyIdempotencyKeys()).toBe(true);
  });

  it('throws on duplicate idempotency key', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED', 1000, 'idem-1'));
    expect(() => ledger.append(entry('E2', 'GATEWAY_REQUESTED', 1000, 'idem-1')))
      .toThrow(DuplicateIdempotencyKeyError);
  });

  it('allows null idempotency keys (not required for all events)', () => {
    const ledger = new PaymentLedger()
      .append(entry('E1', 'INTENT_CREATED'))
      .append(entry('E2', 'GATEWAY_REQUESTED'));
    expect(ledger.verifyIdempotencyKeys()).toBe(true);
  });
});

describe('PaymentLedger — immutability', () => {
  it('append returns a new instance', () => {
    const l1 = new PaymentLedger();
    const l2 = l1.append(entry('E1', 'INTENT_CREATED'));
    expect(l1).not.toBe(l2);
    expect(l1.entries).toHaveLength(0);
    expect(l2.entries).toHaveLength(1);
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test_secret';
  const payload = '{"event":"payment.success","id":"PAY-001"}';

  function sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  }

  it('returns true for a valid signature', () => {
    const sig = sign(payload, secret);
    expect(verifyWebhookSignature({ payload, signature: sig, secret })).toBe(true);
  });

  it('throws InvalidWebhookSignatureError for invalid signature', () => {
    const sig = sign(payload, 'wrong_secret');
    expect(() => verifyWebhookSignature({ payload, signature: sig, secret }))
      .toThrow(InvalidWebhookSignatureError);
  });

  it('throws on empty payload', () => {
    expect(() => verifyWebhookSignature({ payload: '', signature: 'abc', secret }))
      .toThrow(InvalidWebhookSignatureError);
  });

  it('throws on missing signature', () => {
    expect(() => verifyWebhookSignature({ payload, signature: '', secret }))
      .toThrow(InvalidWebhookSignatureError);
  });

  it('throws on missing secret', () => {
    expect(() => verifyWebhookSignature({ payload, signature: 'abc', secret: '' }))
      .toThrow(InvalidWebhookSignatureError);
  });

  it('throws on signature length mismatch', () => {
    expect(() => verifyWebhookSignature({ payload, signature: 'tooshort', secret }))
      .toThrow(InvalidWebhookSignatureError);
  });
});
