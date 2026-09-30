import Decimal from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP, precision: 34 });

/**
 * Exact money. Wraps `decimal.js` so arithmetic never drifts like binary floats
 * do (₹0.1 + ₹0.2 must be ₹0.30, not ₹0.30000000004). The domain imports this,
 * not `@prisma/client`, to stay pure and framework-free.
 *
 * Paisa (2-decimal) rounding happens only at line-total boundaries, never on a
 * per-unit price mid-calculation — rounding early is how money bugs are born.
 */
export class Money {
  private readonly _value: Decimal;

  constructor(value: Decimal.Value) {
    this._value = new Decimal(value);
  }

  get value(): Decimal {
    return this._value;
  }

  plus(other: Money): Money {
    return new Money(this._value.plus(other._value));
  }

  minus(other: Money): Money {
    return new Money(this._value.minus(other._value));
  }

  times(multiplier: Decimal.Value): Money {
    return new Money(this._value.times(multiplier));
  }

  dividedBy(divisor: Decimal.Value): Money {
    return new Money(this._value.dividedBy(divisor));
  }

  /** Round to whole paisa (2 decimal places, half-up). */
  round(): Money {
    return new Money(this._value.toDecimalPlaces(2));
  }

  isNegative(): boolean {
    return this._value.isNegative();
  }

  isZero(): boolean {
    return this._value.isZero();
  }

  lessThan(other: Money): boolean {
    return this._value.lessThan(other._value);
  }

  greaterThan(other: Money): boolean {
    return this._value.greaterThan(other._value);
  }

  greaterThanOrEqualTo(other: Money): boolean {
    return this._value.greaterThanOrEqualTo(other._value);
  }

  lessThanOrEqualTo(other: Money): boolean {
    return this._value.lessThanOrEqualTo(other._value);
  }

  /** The smaller of two amounts. Used to clamp a discount to what is left to discount. */
  static min(a: Money, b: Money): Money {
    return a._value.lessThan(b._value) ? a : b;
  }

  /** The larger of two amounts. Used to floor a total at zero. */
  static max(a: Money, b: Money): Money {
    return a._value.greaterThan(b._value) ? a : b;
  }

  equals(other: Money): boolean {
    return this._value.equals(other._value);
  }

  /** Exact, unrounded string (e.g. for an exact per-unit price). */
  toRaw(): string {
    return this._value.toString();
  }

  /** Paisa-rounded string (e.g. for a line total), always 2 decimals. */
  toString(): string {
    return this._value.toDecimalPlaces(2).toFixed(2);
  }
}

export const ZERO = new Money(0);

/**
 * A stored money column as the string the API sends.
 *
 * Postgres `Decimal(18,4)` round-trips through `decimal.js`, whose `toString()`
 * drops trailing zeros: the same ₹236.00 that the builder prints as `"236.00"`
 * comes back from the database as `"236"`. Two representations of one amount is
 * a defect wherever a caller compares them — an idempotent replay that echoes the
 * stored row against a first response that echoed the computed draft would return
 * two different strings for the same invoice, and a client cannot tell whether the
 * money changed or only its formatting did.
 *
 * So every money value leaving a service goes through this, and the scale is the
 * paisa the rest of the domain already rounds at. Non-money numerics (a quantity
 * in fractional strips, a tax rate) are left to `toString()`: forcing them to two
 * places would invent precision they do not have.
 */
export function paisa(value: Decimal.Value): string {
  return new Money(value).toString();
}
