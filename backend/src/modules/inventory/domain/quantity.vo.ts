import Decimal from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP, precision: 34 });

export class Quantity {
  private readonly _value: Decimal;

  constructor(value: Decimal.Value) {
    this._value = new Decimal(value);
  }

  get value(): Decimal {
    return this._value;
  }

  plus(other: Quantity): Quantity {
    return new Quantity(this._value.plus(other._value));
  }

  minus(other: Quantity): Quantity {
    return new Quantity(this._value.minus(other._value));
  }

  times(multiplier: Decimal.Value): Quantity {
    return new Quantity(this._value.times(multiplier));
  }

  isNegative(): boolean {
    return this._value.isNegative();
  }

  isZero(): boolean {
    return this._value.isZero();
  }

  isPositive(): boolean {
    return this._value.isPositive();
  }

  lessThan(other: Quantity): boolean {
    return this._value.lessThan(other._value);
  }

  greaterThan(other: Quantity): boolean {
    return this._value.greaterThan(other._value);
  }

  greaterThanOrEqualTo(other: Quantity): boolean {
    return this._value.greaterThanOrEqualTo(other._value);
  }

  lessThanOrEqualTo(other: Quantity): boolean {
    return this._value.lessThanOrEqualTo(other._value);
  }

  equals(other: Quantity): boolean {
    return this._value.equals(other._value);
  }

  toDecimalPlaces(dp: number): Quantity {
    return new Quantity(this._value.toDecimalPlaces(dp));
  }

  toFixed(dp = 4): string {
    return this._value.toFixed(dp);
  }

  toString(): string {
    return this._value.toString();
  }
}

export const ZERO_QTY = new Quantity(0);
