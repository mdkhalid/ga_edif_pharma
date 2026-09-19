import { SmtpEmailTransport } from '../../src/infra/notifications/email-transport';
import { testConfig } from '../support/config';
import { startFakeSmtpServer, type FakeSmtpServer } from '../support/fake-smtp';

/**
 * The SMTP transport, over a real socket.
 *
 * A fresh server per test, so each assertion sees exactly the traffic its own
 * `send` produced and order never matters.
 */
describe('SmtpEmailTransport', () => {
  let smtp: FakeSmtpServer;

  beforeEach(async () => {
    smtp = await startFakeSmtpServer();
  });

  afterEach(async () => {
    await smtp.close();
  });

  function buildTransport(from = 'MediChain <no-reply@medichain.test>'): SmtpEmailTransport {
    return new SmtpEmailTransport(
      testConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: smtp.port, SMTP_FROM: from }),
    );
  }

  it('delivers the message to the server', async () => {
    await buildTransport().send({
      to: 'buyer@example.test',
      subject: 'Order 4d2e0c4d placed',
      body: '2 items · INR 70',
    });

    expect(smtp.recipients).toEqual(['buyer@example.test']);
    expect(smtp.messages).toHaveLength(1);
  });

  it('sends the rendered subject and body verbatim', async () => {
    await buildTransport().send({
      to: 'buyer@example.test',
      subject: 'Order 4d2e0c4d placed',
      body: '2 items - INR 70',
    });

    const message = smtp.messages[0] ?? '';
    expect(message).toContain('Subject: Order 4d2e0c4d placed');
    expect(message).toContain('2 items - INR 70');
  });

  it('quoted-printable-encodes a non-ASCII body rather than dropping it', async () => {
    // The order template renders a middle dot (`·`), so this is the real case,
    // not a contrived one. The character must survive as the correct MIME
    // encoding — asserting the raw string here would be asserting that the
    // transport corrupts a valid header into a non-ASCII one.
    await buildTransport().send({
      to: 'buyer@example.test',
      subject: 'Order placed',
      body: '2 items · INR 70',
    });

    const message = smtp.messages[0] ?? '';
    expect(message).toContain('quoted-printable');
    expect(message).toContain('=C2=B7');
  });

  it('uses the configured envelope sender', async () => {
    await buildTransport('MediChain <orders@medichain.test>').send({
      to: 'buyer@example.test',
      subject: 'Order placed',
      body: 'ok',
    });

    expect(smtp.messages[0] ?? '').toContain('orders@medichain.test');
  });

  it('sends the body as plain text, not HTML', async () => {
    // The templates render plain text and the criterion is that a message
    // arrives; an HTML part would be a second rendering path with its own
    // escaping rules, which a plain-text notice does not need.
    await buildTransport().send({
      to: 'buyer@example.test',
      subject: 'Order placed',
      body: 'plain <not-a-tag>',
    });

    const message = smtp.messages[0] ?? '';
    expect(message.toLowerCase()).not.toContain('text/html');
    expect(message).toContain('plain <not-a-tag>');
  });

  it('rejects when the server refuses the connection', async () => {
    // A port nothing is listening on: the transport must surface the failure so
    // the routing adapter can decide what to do with it.
    const unreachable = new SmtpEmailTransport(
      testConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: 1 }),
    );

    await expect(
      unreachable.send({ to: 'buyer@example.test', subject: 'x', body: 'y' }),
    ).rejects.toThrow();
  });
});
