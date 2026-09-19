import { createServer, type AddressInfo, type Server } from 'node:net';

/**
 * A minimal in-process SMTP server, for testing the email transport for real.
 *
 * The alternative — mocking nodemailer — would assert that the adapter calls a
 * function, which is exactly the part that is obvious from reading it. What is
 * worth verifying is that a message actually leaves the process as a valid SMTP
 * conversation, and that needs something on the other end of a socket.
 *
 * It speaks only what nodemailer needs for an unauthenticated plaintext
 * delivery: greeting, EHLO, MAIL, RCPT, DATA, QUIT. It deliberately advertises
 * neither STARTTLS nor AUTH — that is what keeps the conversation readable here
 * — and no capabilities at all beyond 8BITMIME, so nothing is pipelined.
 */

export interface FakeSmtpServer {
  readonly port: number;
  /** Message bodies, in the order they were received, headers included. */
  readonly messages: string[];
  /** Envelope recipients across all deliveries, in order. */
  readonly recipients: string[];
  close(): Promise<void>;
}

export async function startFakeSmtpServer(): Promise<FakeSmtpServer> {
  const messages: string[] = [];
  const recipients: string[] = [];

  const server: Server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 fake.test ESMTP ready\r\n');

    let buffer = '';
    let inData = false;
    let current: string[] = [];

    socket.on('data', (chunk: string) => {
      buffer += chunk;

      for (;;) {
        const breakAt = buffer.indexOf('\r\n');
        if (breakAt === -1) return;

        const line = buffer.slice(0, breakAt);
        buffer = buffer.slice(breakAt + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(current.join('\r\n'));
            current = [];
            socket.write('250 2.0.0 Ok: queued\r\n');
          } else {
            // Undo dot-stuffing, which SMTP requires for a body line that
            // starts with a period.
            current.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        const command = line.toUpperCase();

        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          // No STARTTLS, no AUTH, no PIPELINING: the simplest conversation the
          // client will accept.
          socket.write('250-fake.test\r\n250 8BITMIME\r\n');
        } else if (command.startsWith('MAIL FROM')) {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (command.startsWith('RCPT TO')) {
          const match = /<([^>]*)>/.exec(line);
          recipients.push(match?.[1] ?? line);
          socket.write('250 2.1.5 Ok\r\n');
        } else if (command === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else if (command === 'RSET') {
          socket.write('250 2.0.0 Ok\r\n');
        } else {
          socket.write('250 2.0.0 Ok\r\n');
        }
      }
    });

    socket.on('error', () => {
      // A client that hangs up mid-conversation is not this test's concern.
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    messages,
    recipients,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
