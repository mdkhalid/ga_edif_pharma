/**
 * Order-placed templates, email and SMS.
 *
 * Pure rendering: no transport, no I/O, unit-tested. The adapter sends what
 * these return, so a template change never touches delivery code and a
 * transport change never touches wording.
 */

export interface OrderPlacedTemplateInput {
  readonly orderId: string;
  readonly total: string;
  readonly currency: string;
  readonly itemCount: number;
  readonly tenantName: string;
}

export interface OrderPlacedTemplate {
  readonly emailSubject: string;
  readonly emailBody: string;
  readonly smsBody: string;
}

export function renderOrderPlaced(input: OrderPlacedTemplateInput): OrderPlacedTemplate {
  const shortId = input.orderId.slice(0, 8);
  const summary =
    `${input.itemCount} item${input.itemCount === 1 ? '' : 's'} · ` +
    `${input.currency} ${input.total}`;

  return {
    emailSubject: `Order ${shortId} confirmed — ${input.tenantName}`,
    emailBody:
      `Your order ${input.orderId} has been placed with ${input.tenantName}.\n` +
      `${summary}.\n` +
      `You will receive dispatch updates on this address.`,
    smsBody: `${input.tenantName}: order ${shortId} placed (${summary}).`,
  };
}
