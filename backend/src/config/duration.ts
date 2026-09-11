const DURATION_PATTERN = /^(\d+)\s*(ms|s|m|h|d)?$/i;

const UNIT_TO_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a duration string into milliseconds.
 *
 *   '15m' -> 900000    '30d' -> 2592000000    '500ms' -> 500    '45' -> 45000
 *
 * A bare number is interpreted as seconds, matching the common convention for
 * TTL settings. An unparseable value throws rather than silently becoming NaN —
 * a NaN TTL would make every token expire immediately, or never.
 */
export function parseDurationMs(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (match === null) {
    throw new Error(
      `Invalid duration "${value}". Expected forms: 500ms, 30s, 15m, 2h, 30d.`,
    );
  }

  const amount = match[1];
  const unit = match[2];

  if (amount === undefined) {
    throw new Error(`Invalid duration "${value}".`);
  }

  const multiplier = UNIT_TO_MS[(unit ?? 's').toLowerCase()];
  if (multiplier === undefined) {
    throw new Error(`Unsupported duration unit in "${value}".`);
  }

  return Number(amount) * multiplier;
}
