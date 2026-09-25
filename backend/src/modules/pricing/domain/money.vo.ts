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
