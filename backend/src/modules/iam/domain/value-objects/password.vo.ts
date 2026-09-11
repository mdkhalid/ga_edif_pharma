import { ValidationFailedError } from '../../../../common/exceptions/domain.exception';

/**
 * Password policy.
 *
 * ## Why there is no "must contain an uppercase letter and a symbol" rule
 *
 * Composition rules are a documented failure. They push people towards
 * `Password1!` — a password that satisfies every rule and appears in every
 * breach corpus — while rejecting genuinely strong passphrases like
 * `correct-horse-battery-staple` for lacking a digit. NIST SP 800-63B dropped
 * composition requirements for exactly this reason and instead recommends
 * length, a blocklist, and no forced rotation.
 *
 * So the policy is:
 *
 *   - a length floor that makes brute force impractical,
 *   - a length ceiling, because argon2's cost scales with input and an unbounded
 *     password is a cheap way to exhaust the server's CPU,
 *   - a blocklist of the passwords that actually appear at the top of breach
 *     dumps,
 *   - a check that the password is not derived from the user's own identifiers,
 *     which is what a targeted attacker tries first.
 *
 * ## Why there is no "must not be reused" check here
 *
 * Password history is enforced at the persistence layer against the previous
 * hashes. Doing it here would mean this value object needs database access,
 * which would make it untestable in isolation and would let a policy violation
 * through whenever a caller forgot to pass the history in.
 */

export const PASSWORD_MIN_LENGTH = 12;
/** Argon2's cost is linear in input length; 128 is generous and bounded. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * A short blocklist of the passwords that dominate real breach corpora.
 *
 * Deliberately small and inline. A full list belongs in a dedicated store
 * (Have I Been Pwned's k-anonymity API is the usual choice) and is a Phase 2
 * item; shipping a 10-million-entry file in the repository for Phase 0 would be
 * a poor trade. These entries alone eliminate the most common choices, which is
 * where most of the benefit is.
 */
const BLOCKED_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwerty123',
  'letmein',
  'welcome',
  'welcome1',
  'admin',
  'admin123',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'abc123',
  'changeme',
  'medichain',
  'pharma123',
  'test1234',
  'testtest',
]);

/**
 * A validated plaintext password.
 *
 * The value is held only long enough to be hashed. It is never logged, never
 * serialised, and has no `toString()` that returns it — `toString()` returns a
 * redacted marker instead, so an accidental interpolation into a log line or an
 * error message produces `[REDACTED]` rather than the password.
 */
export class Password {
  private constructor(private readonly plaintext: string) {}

  /**
   * Validates a candidate against the policy.
   *
   * @param context Values the password must not be derived from — the user's
   *   email local part, their name, their phone. Passed in rather than looked up
   *   so this stays a pure function.
   */
  static create(candidate: string, context: readonly string[] = []): Password {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new ValidationFailedError('A password is required.', {
        errors: [{ field: 'password', code: 'isNotEmpty', message: 'A password is required.' }],
      });
    }

    if (candidate.length < PASSWORD_MIN_LENGTH) {
      throw new ValidationFailedError(
        `The password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
        {
          errors: [
            {
              field: 'password',
              code: 'minLength',
              message: `Use at least ${PASSWORD_MIN_LENGTH} characters. A short phrase of a few words is stronger and easier to remember than a short jumble of symbols.`,
            },
          ],
        },
      );
    }

    if (candidate.length > PASSWORD_MAX_LENGTH) {
      throw new ValidationFailedError(
        `The password must be at most ${PASSWORD_MAX_LENGTH} characters long.`,
        {
          errors: [
            {
              field: 'password',
              code: 'maxLength',
              message: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
            },
          ],
        },
      );
    }

    // Normalised comparison for the blocklist only. The password itself is hashed
    // byte-for-byte as supplied — normalising before hashing would make two
    // visually identical passwords interchangeable, which is a surprise nobody
    // wants when their password manager generated a Unicode one.
    const normalised = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (BLOCKED_PASSWORDS.has(candidate.toLowerCase()) || BLOCKED_PASSWORDS.has(normalised)) {
      throw new ValidationFailedError('This password is too common and easily guessed.', {
        errors: [
          {
            field: 'password',
            code: 'tooCommon',
            message:
              'This password appears in public breach lists. Choose something else.',
          },
        ],
      });
    }

    for (const value of context) {
      const token = value.trim().toLowerCase();
      // Four characters is the point below which a match is coincidence rather
      // than a derivation. `admin@x.com` should block `admin12345`, but a user
      // named "Lee" should not be blocked from any password containing "lee".
      if (token.length < 4) continue;

      if (candidate.toLowerCase().includes(token)) {
        throw new ValidationFailedError(
          'The password must not contain your name, email address or phone number.',
          {
            errors: [
              {
                field: 'password',
                code: 'derivedFromIdentity',
                message:
                  'The password must not contain your name, email address or phone number — an attacker tries those first.',
              },
            ],
          },
        );
      }
    }

    return new Password(candidate);
  }

  /** The plaintext, for the single call that hashes it. */
  reveal(): string {
    return this.plaintext;
  }

  /**
   * Redacted. Defined so that an accidental `${password}` in a template literal
   * or a logger argument cannot disclose the value.
   */
  toString(): string {
    return '[REDACTED]';
  }

  /** Also redacted, for `util.inspect` and `JSON.stringify` paths. */
  toJSON(): string {
    return '[REDACTED]';
  }

  /**
   * Node's `util.inspect` hook. Without it, `console.log(password)` would print
   * `Password { plaintext: '…' }` — the private field is a compile-time
   * restriction, not a runtime one.
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED]';
  }
}

/**
 * Generates a strong random passphrase for seeded and invited accounts.
 *
 * Built from the CSPRNG rather than `Math.random()`, and grouped for legibility
 * when an operator has to read one off a screen and type it elsewhere.
 */
export function generateStrongPassword(): string {
  // Ambiguous characters (0/O, 1/l/I) are excluded: these values get read aloud
  // and retyped, and an unclear glyph turns into a support ticket.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = new Uint8Array(24);
  // `crypto.getRandomValues` is available in Node 22 and in React Native, so
  // this helper stays usable on both sides of the wire.
  globalThis.crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
