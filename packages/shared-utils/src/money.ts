/**
 * Money value object — the only sanctioned way to do arithmetic on currency.
 *
 * Rules this class enforces (see docs/03 ADR-010 and docs/09):
 *   1. Never use JavaScript `number` arithmetic on money. Binary floating point
 *      cannot represent 0.1 exactly, and the error compounds across thousands of
 *      invoice lines into a real reconciliation failure.
 *   2. Never mix currencies silently. `INR + USD` throws.
 *   3. Round exactly once, at a documented boundary, with an explicit mode.
 *   4. Serialise as a decimal STRING. A JSON number is an IEEE-754 double in
 *      most parsers and will lose precision before the value is ever read.
 *
 * Pure JavaScript — no Node built-ins — so React Native can use it too.
 */

import Decimal from 'decimal.js';

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 21,
});

export type CurrencyCode = string;
export type MoneyInput = string | number | Decimal | Money;

export const DEFAULT_CURRENCY: CurrencyCode = 'INR';

/** Storage precision. Matches `NUMERIC(18,4)` in PostgreSQL. */
export const MONEY_SCALE = 4;

/** Display precision for currency amounts. */
export const CURRENCY_SCALE = 2;

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: CurrencyCode,
    readonly right: CurrencyCode,
  ) {
    super(`Cannot operate on different currencies: ${left} and ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyError extends Error {
  constructor(readonly input: unknown) {
    super(`Not a valid money value: ${String(input)}`);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  private readonly amount: Decimal;
  readonly currency: CurrencyCode;

  private constructor(amount: Decimal, currency: CurrencyCode) {
    this.amount = amount;
    this.currency = currency;
  }

  // ---------------------------------------------------------------- factories

  /**
   * Creates a `Money`.
   *
   * The `currency` parameter is optional and, when omitted, means "use this
   * input's own currency, or the default for a bare value".
   *
   * It is deliberately **not** written as `currency = DEFAULT_CURRENCY`. With a
   * default value, `Money.of(someUsdMoney, 'INR')` is indistinguishable from
   * `Money.of(someUsdMoney)` — the caller's explicit request for INR would be
   * silently ignored and they would receive a USD amount that looks correct.
   * Treating `undefined` as "unspecified" keeps the two cases apart, and an
   * explicit mismatch throws.
   */
  static of(value: MoneyInput, currency?: CurrencyCode): Money {
    if (value instanceof Money) {
      if (currency !== undefined && currency !== value.currency) {
        throw new CurrencyMismatchError(value.currency, currency);
      }
      return value;
    }

    let parsed: Decimal;
    try {
      parsed = new Decimal(value as Decimal.Value);
    } catch {
      throw new InvalidMoneyError(value);
    }

    if (!parsed.isFinite()) throw new InvalidMoneyError(value);

    return new Money(parsed, currency ?? DEFAULT_CURRENCY);
  }

  static zero(currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    return new Money(new Decimal(0), currency);
  }

  /** Sums a list without intermediate rounding. Returns zero for an empty list. */
  static sum(values: readonly Money[], currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    return values.reduce<Money>((total, value) => total.add(value), Money.zero(currency));
  }

  // -------------------------------------------------------------- arithmetic

  add(other: MoneyInput): Money {
    const rhs = this.coerce(other);
    return new Money(this.amount.plus(rhs.amount), this.currency);
  }

  subtract(other: MoneyInput): Money {
    const rhs = this.coerce(other);
    return new Money(this.amount.minus(rhs.amount), this.currency);
  }

  /** Multiply by a plain factor (quantity, tax rate, discount ratio). */
  multiply(factor: Decimal.Value): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  divide(divisor: Decimal.Value): Money {
    const d = new Decimal(divisor);
    if (d.isZero()) throw new InvalidMoneyError('division by zero');
    return new Money(this.amount.dividedBy(d), this.currency);
  }

  negate(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  /**
   * Rounds to storage scale (4dp). Call this at documented boundaries only —
   * line total, tax amount, invoice total — never in the middle of a chain.
   */
  roundToStorage(): Money {
    return new Money(this.amount.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP), this.currency);
  }

  /** Rounds to display scale (2dp). For presentation, not for further maths. */
  roundToCurrency(): Money {
    return new Money(this.amount.toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_HALF_UP), this.currency);
  }

  /**
   * Splits an amount by integer weights without losing or inventing a paisa.
   * The remainder is distributed one minor unit at a time, so the parts always
   * sum back to the original. Used for proportional freight and discount
   * allocation across order lines.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) return [];
    if (weights.some((w) => w < 0)) throw new InvalidMoneyError('negative allocation weight');

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return weights.map(() => Money.zero(this.currency));

    const minorUnits = this.amount
      .times(Math.pow(10, MONEY_SCALE))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

    const shares = weights.map((w) =>
      minorUnits.times(w).dividedBy(totalWeight).toDecimalPlaces(0, Decimal.ROUND_FLOOR),
    );

    const distributed = shares.reduce<Decimal>((a, b) => a.plus(b), new Decimal(0));
    let remainder = minorUnits.minus(distributed).toNumber();

    // Hand out the remaining minor units, largest-remainder first.
    const order = weights
      .map((weight, index) => ({ index, fraction: minorUnits.times(weight).dividedBy(totalWeight).minus(shares[index] ?? 0) }))
      .sort((a, b) => b.fraction.comparedTo(a.fraction));

    const result = shares.slice();
    let cursor = 0;
    while (remainder > 0 && order.length > 0) {
      const slot = order[cursor % order.length];
      if (slot !== undefined) {
        const current = result[slot.index];
        if (current !== undefined) result[slot.index] = current.plus(1);
      }
      remainder -= 1;
      cursor += 1;
    }

    return result.map(
      (value) => new Money(value.dividedBy(Math.pow(10, MONEY_SCALE)), this.currency),
    );
  }

  // ---------------------------------------------------------------- compare

  compareTo(other: MoneyInput): number {
    return this.amount.comparedTo(this.coerce(other).amount);
  }

  equals(other: MoneyInput): boolean {
    return this.compareTo(other) === 0;
  }

  greaterThan(other: MoneyInput): boolean {
    return this.compareTo(other) > 0;
  }

  greaterThanOrEqual(other: MoneyInput): boolean {
    return this.compareTo(other) >= 0;
  }

  lessThan(other: MoneyInput): boolean {
    return this.compareTo(other) < 0;
  }

  lessThanOrEqual(other: MoneyInput): boolean {
    return this.compareTo(other) <= 0;
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.isPositive() && !this.amount.isZero();
  }

  // ------------------------------------------------------------- conversion

  /** Fixed-scale decimal string, safe for JSON transport. */
  toJSON(): string {
    return this.amount.toFixed(MONEY_SCALE);
  }

  /** Same as toJSON — explicit name for readability at call sites. */
  toString(): string {
    return this.toJSON();
  }

  /** Compact form for display, e.g. `4903.00`. Never feed back into arithmetic. */
  toDisplayString(scale: number = CURRENCY_SCALE): string {
    return this.amount.toFixed(scale);
  }

  /**
   * Escape hatch for charting and similar numeric consumers.
   * Explicitly named so it is obvious in review when precision is being dropped.
   */
  toNumberUnsafe(): number {
    return this.amount.toNumber();
  }

  private coerce(other: MoneyInput): Money {
    const rhs = Money.of(other, this.currency);
    if (rhs.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, rhs.currency);
    }
    return rhs;
  }
}

/** Convenience factory: `m('1234.56')`. */
export function m(value: MoneyInput, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  return Money.of(value, currency);
}

/**
 * Parses a value that arrived over the wire. Accepts a decimal string or a
 * number, but logs nothing and throws on garbage — a silently-zero money value
 * is far more dangerous than a loud failure.
 */
export function parseMoney(value: unknown, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  if (typeof value === 'string' || typeof value === 'number') {
    return Money.of(value, currency);
  }
  throw new InvalidMoneyError(value);
}
