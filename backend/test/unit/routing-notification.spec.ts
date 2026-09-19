import { OtpPurpose } from '@medichain/shared-types';

import type { EmailTransport, OutboundEmail } from '../../src/infra/notifications/email-transport';
import { RoutingNotificationAdapter } from '../../src/infra/notifications/routing-notification.adapter';
import type { OutboundSms, SmsTransport } from '../../src/infra/notifications/sms-transport';
import { testConfig } from '../support/config';

/**
 * The routing decisions, with the transports stubbed.
 *
 * Transport behaviour has its own tests (see `smtp-email.spec.ts`); what is
 * asserted here is the part that is easy to get wrong and expensive in
 * production: which channel a message takes, and — the one that actually costs
 * money and trust — what happens to the surviving channel when the other fails.
 */
describe('RoutingNotificationAdapter', () => {
  const emailSend = jest.fn<Promise<void>, [OutboundEmail]>(async () => undefined);
  const smsSend = jest.fn<Promise<void>, [OutboundSms]>(async () => undefined);

  const email: EmailTransport = { send: emailSend };
  const sms: SmsTransport = { send: smsSend };

  const adapter = (): RoutingNotificationAdapter =>
    new RoutingNotificationAdapter(email, sms, testConfig({ APP_NAME: 'MediChain' }));

  /**
   * The argument of a mock's first call.
   *
   * `mock.calls[0][0]` does not type-check under `noUncheckedIndexedAccess`,
   * and `!` would trade a compiler error for an unhelpful runtime one. Failing
   * with a sentence is better than failing with "cannot read property of
   * undefined".
   */
  function sentBy<T>(mock: jest.Mock<Promise<void>, [T]>): T {
    const call = mock.mock.calls[0];
    if (call === undefined) throw new Error('Expected the transport to have been called.');
    return call[0];
  }

  const code = {
    code: '417293',
    expiresInMinutes: 10,
  } as const;

  describe('a one-time code', () => {
    it('goes over email when the destination is an address', async () => {
      await adapter().sendOtp({
        ...code,
        destination: 'buyer@example.test',
        purpose: OtpPurpose.VERIFY_CONTACT,
      });

      expect(emailSend).toHaveBeenCalledTimes(1);
      expect(smsSend).not.toHaveBeenCalled();
      expect(sentBy(emailSend).to).toBe('buyer@example.test');
    });

    it('goes over SMS when the destination is a phone number', async () => {
      await adapter().sendOtp({
        ...code,
        destination: '+919876543210',
        purpose: OtpPurpose.LOGIN,
      });

      expect(smsSend).toHaveBeenCalledTimes(1);
      expect(emailSend).not.toHaveBeenCalled();
      expect(sentBy(smsSend).to).toBe('+919876543210');
    });

    it.each([
      [OtpPurpose.LOGIN, 'sign-in'],
      [OtpPurpose.REGISTER, 'registration'],
      [OtpPurpose.RESET_PASSWORD, 'password reset'],
      [OtpPurpose.VERIFY_CONTACT, 'verification'],
    ])('says which flow %s is for', async (purpose, label) => {
      // The code arrives unsolicited; without the purpose the user cannot tell
      // a sign-in code from a password reset — which is exactly the confusion a
      // phishing page relies on.
      await adapter().sendOtp({ ...code, destination: 'buyer@example.test', purpose });

      const body = sentBy(emailSend).body;
      expect(body).toContain(label);
      expect(body).toContain(code.code);
    });

    it('throws when the transport fails, so the code is not reported as sent', async () => {
      emailSend.mockRejectedValueOnce(new Error('smtp unreachable'));

      await expect(
        adapter().sendOtp({
          ...code,
          destination: 'buyer@example.test',
          purpose: OtpPurpose.RESET_PASSWORD,
        }),
      ).rejects.toThrow('smtp unreachable');
    });

    it('does not throw for a destination that is neither an address nor a number', async () => {
      // The port's contract is explicit that an unknown destination is not an
      // error: there is nothing to deliver to, and a caller should not have to
      // pre-validate what the port already handles.
      await expect(
        adapter().sendOtp({ ...code, destination: '   ', purpose: OtpPurpose.LOGIN }),
      ).resolves.toBeUndefined();

      expect(emailSend).not.toHaveBeenCalled();
      expect(smsSend).not.toHaveBeenCalled();
    });
  });

  describe('an order-placed notice', () => {
    const notice = {
      orderId: '4d2e0c4d-4e6a-4450-95df-58e55ec2aa8a',
      total: '70.0000',
      currency: 'INR',
      itemCount: 2,
      emailSubject: 'Order 4d2e0c4d placed',
      emailBody: 'Your order has been placed.',
      smsBody: 'MediChain: order 4d2e0c4d placed.',
      email: 'buyer@example.test',
      phone: '+919876543210',
    } as const;

    it('sends on both channels when both are known', async () => {
      await adapter().sendOrderPlaced(notice);

      expect(emailSend).toHaveBeenCalledTimes(1);
      expect(smsSend).toHaveBeenCalledTimes(1);
    });

    it('sends only the channels the organisation has', async () => {
      await adapter().sendOrderPlaced({ ...notice, phone: null });

      expect(emailSend).toHaveBeenCalledTimes(1);
      expect(smsSend).not.toHaveBeenCalled();
    });

    it('still sends the SMS when the email fails', async () => {
      // The reason this uses `allSettled`: an email outage must not silently
      // cost the SMS as well, and the notice must not fail the order.
      emailSend.mockRejectedValueOnce(new Error('smtp unreachable'));

      await expect(adapter().sendOrderPlaced(notice)).resolves.toBeUndefined();

      expect(smsSend).toHaveBeenCalledTimes(1);
    });

    it('lets an order whose organisation has no contact details pass quietly', async () => {
      await expect(
        adapter().sendOrderPlaced({ ...notice, email: null, phone: null }),
      ).resolves.toBeUndefined();

      expect(emailSend).not.toHaveBeenCalled();
      expect(smsSend).not.toHaveBeenCalled();
    });
  });
});
