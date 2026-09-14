/**
 * Canonicalisation of the "email or phone" identifier.
 *
 * The same person reaches the platform as `Admin@Example.com`, `admin@example.com`,
 * `+91 98765 43210`, `09876543210` and `9876543210`. Every flow that looks an
 * account up by identifier — sign-in, contact verification, password reset — must
 * collapse those to one value, or the lookup misses an account that plainly
 * exists and the partial unique indexes stop preventing duplicate accounts.
 *
 * Kept as pure functions so the rule is identical everywhere and testable without
 * a request, a database or a Nest container.
 */

/**
 * Normalises an email for storage and lookup.
 *
 * Lowercased because `Admin@Example.com` and `admin@example.com` are the same
 * mailbox at every provider that matters, and the column is `citext` — but
 * normalising here too means the value is canonical before it reaches an index or
 * a comparison that might not be case-insensitive.
 */
export function normaliseEmail(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * Normalises a phone number to E.164-ish digits.
 *
 * Indian numbers arrive as `+91 98765 43210`, `09876543210` and `9876543210` —
 * all the same subscriber. Stripping separators and a leading zero collapses them
 * to one value.
 *
 * Not a full E.164 implementation: that needs a country context the request does
 * not always carry. Phase 2 replaces this with a libphonenumber-based parser.
 */
export function normalisePhone(value: string | undefined): string | null {
  if (value === undefined) return null;

  const digits = value.replace(/[^\d+]/g, '');
  if (digits === '') return null;

  // `09876543210` and `9876543210` are the same number.
  const withoutTrunkZero = digits.startsWith('0') ? digits.slice(1) : digits;
  return withoutTrunkZero === '' ? null : withoutTrunkZero;
}

/**
 * The single canonical destination an identifier refers to.
 *
 * An `@` is the discriminator: an identifier containing one is an email, anything
 * else is a phone number. This matters because a one-time code is addressed to a
 * *destination*, and the code issued to `admin@x.com` must not be consumable by a
 * caller that sends `admin` — see the challenge lookup in `OtpService`.
 */
export function otpDestination(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) return normaliseEmail(trimmed);
  return normalisePhone(trimmed);
}

/**
 * The set of `where` clauses that can identify an account from one input.
 *
 * Returns an array so it can be spread directly into a Prisma `OR`. Empty when the
 * identifier cannot be canonicalised, which callers treat as "no such account".
 */
export function identifierCandidates(identifier: string): Array<{ email: string } | { phone: string }> {
  const destination = otpDestination(identifier);
  if (destination === null) return [];

  return identifier.trim().includes('@') ? [{ email: destination }] : [{ phone: destination }];
}
