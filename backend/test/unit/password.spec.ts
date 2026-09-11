import { inspect } from 'node:util';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  Password,
  generateStrongPassword,
} from '../../src/modules/iam/domain/value-objects/password.vo';

/**
 * The password policy is a security boundary and its value object is a
 * disclosure risk: it holds a plaintext secret, and a single `${password}` in a
 * log line would write it to an immutable, widely-readable table. Both
 * properties are pinned here.
 */

const STRONG = 'correct-horse-battery-staple';

describe('length policy', () => {
  it('accepts a long passphrase with no symbols or digits', () => {
    // The point of dropping composition rules: this is stronger than
    // `Password1!` and must not be rejected for lacking a digit.
    expect(Password.create(STRONG).reveal()).toBe(STRONG);
  });

  it('accepts a password of exactly the minimum length', () => {
    const candidate = 'a'.repeat(PASSWORD_MIN_LENGTH);
    expect(Password.create(candidate).reveal()).toBe(candidate);
  });

  it('rejects a password one character below the minimum', () => {
    expect(() => Password.create('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toThrow(
      /at least 12 characters/,
    );
  });

  it('accepts a password of exactly the maximum length', () => {
    const candidate = 'a'.repeat(PASSWORD_MAX_LENGTH);
    expect(Password.create(candidate).reveal()).toBe(candidate);
  });

  it('rejects a password above the maximum', () => {
    // Argon2's cost is linear in input, so an unbounded password is a cheap way
    // to burn the server's CPU.
    expect(() => Password.create('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toThrow(
      /at most 128 characters/,
    );
  });

  it('rejects an empty password', () => {
    expect(() => Password.create('')).toThrow(/required/);
  });

  it('rejects a non-string, which a JSON body can produce', () => {
    expect(() => Password.create(undefined as unknown as string)).toThrow(/required/);
    expect(() => Password.create(null as unknown as string)).toThrow(/required/);
  });

  it('reports the failure against the password field', () => {
    // The API returns RFC 9457 field errors, so the field name must be right.
    try {
      Password.create('short');
      throw new Error('expected a rejection');
    } catch (error) {
      const meta = (error as { meta?: { errors?: Array<{ field: string; code: string }> } }).meta;
      expect(meta?.errors?.[0]?.field).toBe('password');
      expect(meta?.errors?.[0]?.code).toBe('minLength');
    }
  });
});

describe('the breach blocklist', () => {
  it('rejects a blocklisted password that clears the length floor', () => {
    expect(() => Password.create('administrator')).toThrow(/too common/);
  });

  it('rejects an obfuscated variant the length rule alone would allow', () => {
    // This is where the blocklist earns its place. `password123!` is 12
    // characters, so length accepts it; only normalisation catches that it is
    // `password123` with a character bolted on — exactly the shape a composition
    // rule pushes users towards.
    expect(() => Password.create('password123!')).toThrow(/too common/);
  });

  it('matches after stripping separators', () => {
    expect(() => Password.create('Pass-word-123')).toThrow(/too common/);
  });

  it('matches case-insensitively', () => {
    expect(() => Password.create('PASSWORD123!')).toThrow(/too common/);
  });

  it('names the problem, rather than blaming the length rule', () => {
    try {
      Password.create('administrator');
      throw new Error('expected a rejection');
    } catch (error) {
      const meta = (error as { meta?: { errors?: Array<{ code: string }> } }).meta;
      expect(meta?.errors?.[0]?.code).toBe('tooCommon');
    }
  });

  it('accepts a passphrase that merely contains a blocked word', () => {
    // The blocklist tests the whole password, not a substring, or it would
    // reject far too much.
    expect(Password.create('my-monkey-is-a-battery-staple').reveal()).toBe(
      'my-monkey-is-a-battery-staple',
    );
  });

  it('is mostly redundant with the length floor, which is a deliberate trade', () => {
    // Almost every blocklist entry is shorter than the 12-character minimum, so
    // the length rule rejects it first. The blocklist's real work is catching
    // longer variants — see the normalisation tests above. A full breach corpus
    // (Have I Been Pwned's k-anonymity API) is the Phase 2 answer; this asserts
    // the current design rather than pretending the list is doing more.
    const shortEntries = ['password', 'qwerty', 'letmein', 'admin', 'dragon'];
    for (const entry of shortEntries) {
      expect(() => Password.create(entry)).toThrow(/at least 12 characters/);
    }
  });
});

describe('identity derivation', () => {
  it('rejects a password containing the email local part', () => {
    // This is the case that matters: nobody's password contains the whole
    // address, but plenty contain their own username.
    expect(() => Password.create('admin-is-my-password', ['admin@sunrisepharma.local'])).toThrow(
      /must not contain your name/,
    );
  });

  it('rejects a password containing the whole email address', () => {
    expect(() =>
      Password.create('me-at-admin@sunrisepharma.local-x', ['admin@sunrisepharma.local']),
    ).toThrow(/must not contain your name/);
  });

  it('rejects a password containing a name part', () => {
    expect(() => Password.create('priya-is-my-password', ['Priya', 'Sharma'])).toThrow(
      /must not contain your name/,
    );
  });

  it('ignores a context token shorter than four characters', () => {
    // Four is the point below which a match is coincidence. A user named "Lee"
    // must not be blocked from every password containing "lee".
    expect(Password.create('sleepy-leek-soup-for-me', ['Lee']).reveal()).toBe(
      'sleepy-leek-soup-for-me',
    );
  });

  it('ignores an empty context value', () => {
    expect(() => Password.create(STRONG, ['', '   '])).not.toThrow();
  });

  it('handles a context value with a leading @', () => {
    // `@handle` would otherwise yield an empty local part.
    expect(() => Password.create(STRONG, ['@handle'])).not.toThrow();
  });

  it('is case-insensitive', () => {
    expect(() => Password.create('ADMIN-is-my-password', ['admin@x.com'])).toThrow();
  });

  it('accepts a password unrelated to any identifier', () => {
    expect(() =>
      Password.create(STRONG, ['admin@sunrisepharma.local', 'Priya', 'Sharma', '+919876543210']),
    ).not.toThrow();
  });
});

describe('the plaintext never leaks', () => {
  it('redacts toString, so an interpolated password is not logged', () => {
    const password = Password.create(STRONG);
    expect(`${password}`).toBe('[REDACTED]');
    expect(String(password)).toBe('[REDACTED]');
  });

  it('redacts toJSON, so a serialised object cannot carry it', () => {
    expect(JSON.stringify({ password: Password.create(STRONG) })).toBe(
      '{"password":"[REDACTED]"}',
    );
  });

  it('redacts util.inspect, which is what console.log uses', () => {
    // Without the inspect hook, `console.log(password)` prints
    // `Password { plaintext: '…' }` — the private modifier is compile-time only.
    const rendered = inspect(Password.create(STRONG));
    expect(rendered).toBe('[REDACTED]');
    expect(rendered).not.toContain(STRONG);
  });

  it('redacts when nested inside a logged object', () => {
    const rendered = inspect({ credentials: Password.create(STRONG) });
    expect(rendered).not.toContain(STRONG);
  });

  it('still exposes the value through reveal(), which hashing needs', () => {
    expect(Password.create(STRONG).reveal()).toBe(STRONG);
  });

  it('does not put the plaintext in the error for a rejected password', () => {
    const secret = 'admin-should-not-appear-here';
    try {
      Password.create(secret, ['admin@x.com']);
      throw new Error('expected a rejection');
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});

describe('generateStrongPassword', () => {
  it('produces a password the policy accepts', () => {
    // A generator that can emit a password the policy rejects is a latent bug in
    // every invite flow.
    for (let i = 0; i < 25; i += 1) {
      expect(() => Password.create(generateStrongPassword())).not.toThrow();
    }
  });

  it('is long enough to clear the minimum', () => {
    expect(generateStrongPassword().length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
  });

  it('avoids visually ambiguous characters', () => {
    // These values get read off a screen and retyped; `0`/`O`/`o` and `1`/`l`/`I`
    // are indistinguishable in most UI fonts.
    for (let i = 0; i < 25; i += 1) {
      expect(generateStrongPassword()).not.toMatch(/[0Oo1lI]/);
    }
  });

  it('does not repeat', () => {
    const generated = new Set(Array.from({ length: 200 }, () => generateStrongPassword()));
    expect(generated.size).toBe(200);
  });
});
