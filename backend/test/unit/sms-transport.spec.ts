import {
  ConsoleSmsTransport,
  Msg91SmsTransport,
  TwilioSmsTransport,
} from '../../src/infra/notifications/sms-transport';
import { testConfig } from '../support/config';

/**
 * The SMS providers, with `fetch` stubbed.
 *
 * What is worth asserting is the request the provider will actually receive:
 * the endpoint, the credential, and — for MSG91, whose `sendhttp` endpoint
 * takes the message in a query string — that the body is properly encoded
 * rather than pasted into a URL. A message containing `&` or `#` would be
 * silently truncated otherwise, and the failure would look like a provider bug.
 */
describe('SMS transports', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  function firstFetchCall(): { url: string; init: RequestInit | undefined } {
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error('Expected fetch to have been called.');
    return { url: String(call[0]), init: call[1] };
  }

  describe('MSG91', () => {
    const API_KEY = 'key-abc123';

    const transport = (): Msg91SmsTransport =>
      new Msg91SmsTransport(
        testConfig({ SMS_PROVIDER: 'msg91', SMS_API_KEY: API_KEY, SMS_SENDER_ID: 'MEDCHN' }),
      );

    it('sends the message as parameters of the sendhttp endpoint', async () => {
      await transport().send({ to: '+919876543210', body: 'Your code is 417293' });

      const url = new URL(firstFetchCall().url);
      expect(`${url.origin}${url.pathname}`).toBe('https://api.msg91.com/api/sendhttp.php');
      expect(url.searchParams.get('authkey')).toBe(API_KEY);
      expect(url.searchParams.get('mobiles')).toBe('+919876543210');
      expect(url.searchParams.get('sender')).toBe('MEDCHN');
      expect(url.searchParams.get('message')).toBe('Your code is 417293');
    });

    it('encodes a body containing URL metacharacters intact', async () => {
      // The case that makes naive string interpolation fail: an unencoded `&`
      // would start a new query parameter and truncate the message.
      const body = 'Order A&B #42 — 2 items';

      await transport().send({ to: '+919876543210', body });

      const url = new URL(firstFetchCall().url);
      expect(url.searchParams.get('message')).toBe(body);
    });

    it('reports a rejection without disclosing the credential', async () => {
      fetchMock.mockResolvedValue(new Response('denied', { status: 401 }));

      const error: unknown = await transport()
        .send({ to: '+919876543210', body: 'x' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      // The auth key travels in the URL, so an error carrying the URL would put
      // the credential into every log line and error report.
      expect((error as Error).message).toContain('401');
      expect((error as Error).message).not.toContain(API_KEY);
    });
  });

  describe('Twilio', () => {
    const ACCOUNT_SID = 'AC00000000000000000000000000000000';
    const AUTH_TOKEN = 'token-xyz';
    const FROM = '+15550001111';

    const transport = (): TwilioSmsTransport =>
      new TwilioSmsTransport(
        testConfig({
          SMS_PROVIDER: 'twilio',
          SMS_API_KEY: AUTH_TOKEN,
          SMS_SENDER_ID: FROM,
          TWILIO_ACCOUNT_SID: ACCOUNT_SID,
        }),
      );

    it('posts a form-encoded message to the account’s Messages resource', async () => {
      await transport().send({ to: '+919876543210', body: 'Your code is 417293' });

      const { url, init } = firstFetchCall();
      expect(url).toContain(`/Accounts/${ACCOUNT_SID}/Messages.json`);
      expect(init?.method).toBe('POST');
      expect((init?.body as URLSearchParams).get('To')).toBe('+919876543210');
      expect((init?.body as URLSearchParams).get('From')).toBe(FROM);
      expect((init?.body as URLSearchParams).get('Body')).toBe('Your code is 417293');
    });

    it('authenticates with HTTP Basic using the SID and the auth token', async () => {
      await transport().send({ to: '+919876543210', body: 'x' });

      const headers = firstFetchCall().init?.headers as Record<string, string>;
      const expected = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
      expect(headers['Authorization']).toBe(`Basic ${expected}`);
    });

    it('reports a rejection without disclosing the credential', async () => {
      fetchMock.mockResolvedValue(new Response('denied', { status: 401 }));

      const error: unknown = await transport()
        .send({ to: '+919876543210', body: 'x' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('401');
      expect((error as Error).message).not.toContain(AUTH_TOKEN);
    });
  });

  describe('the console fallback', () => {
    it('writes to the log instead of calling a provider', async () => {
      await expect(
        new ConsoleSmsTransport().send({ to: '+919876543210', body: 'x' }),
      ).resolves.toBeUndefined();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
