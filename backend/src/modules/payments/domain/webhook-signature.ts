import { createHmac, timingSafeEqual } from 'crypto';

export class InvalidWebhookSignatureError extends Error {
  constructor(public readonly reason: string) {
    super(`Invalid webhook signature: ${reason}`);
    this.name = 'InvalidWebhookSignatureError';
  }
}

export interface VerifyWebhookInput {
  readonly payload: string;
  readonly signature: string;
  readonly secret: string;
  readonly algorithm?: string;
}

export function verifyWebhookSignature(input: VerifyWebhookInput): boolean {
  if (!input.payload || input.payload.length === 0) {
    throw new InvalidWebhookSignatureError('empty payload');
  }

  if (!input.signature || input.signature.length === 0) {
    throw new InvalidWebhookSignatureError('missing signature');
  }

  if (!input.secret || input.secret.length === 0) {
    throw new InvalidWebhookSignatureError('missing secret');
  }

  const expected = createHmac('sha256', input.secret)
    .update(input.payload, 'utf8')
    .digest('hex');

  const providedBuf = Buffer.from(input.signature, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (providedBuf.length !== expectedBuf.length) {
    throw new InvalidWebhookSignatureError('signature length mismatch');
  }

  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    throw new InvalidWebhookSignatureError('signature mismatch');
  }

  return true;
}
