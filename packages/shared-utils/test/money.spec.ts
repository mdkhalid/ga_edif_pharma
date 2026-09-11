/**
 * Money arithmetic.
 *
 * ## What these tests are actually protecting
 *
 * Every assertion here exists because the naive implementation gets it wrong in
 * a way that is invisible until money has already moved:
 *
 *   - **Binary floating point.** `0.1 + 0.2 === 0.30000000000000004` in IEEE-754.
 *     A ledger built on `number` drifts by fractions of a paisa per operation,
 *     and after a year of invoices the totals no longer reconcile against the
 *     bank. The first test below is the canonical demonstration.
 *   - **Intermediate rounding.** Rounding each line to 2dp and then summing
 *     produces a different total than summing and rounding once. A tax invoice
 *     must state the figure the tax authority computes, so the order of
 *     operations is part of the contract.
 *   - **Allocation remainder.** Splitting a freight charge across three order
 *     lines by percentage loses a paisa if the parts are rounded independently.
 *     A paisa lost per order is a reconciliation failure at month end.
 *
 * ## Why the assertions compare strings
 *
 * `expect(m('0.1').add('0.2').toJSON()).toBe('0.3000')` compares the exact
 * decimal representation. Comparing numbers instead would silently accept the
 * very imprecision these tests exist to catch.
 */
import {
  CURRENCY_SCALE,
  CurrencyMismatchError,
  InvalidMoneyError,
  MONEY_SCALE,
  Money,
  m,
  parseMoney,
} from '../src/money';

describe('scale constants', () => {
  it('stores money at 4 decimal places and displays at 2', () => {
    expect(MONEY_SCALE).toBe(4);
    expect(CURRENCY_SCALE).toBe(2);
  });
});

describe('Money.of', () => {
  it('accepts a decimal string', () => {
    expect(m('1234.5678').toJSON()).toBe('1234.5678');
  });

  it('accepts a number', () => {
    expect(m(100).toJSON()).toBe('100.0000');
  });

  it('returns the same instance when given a Money in the same currency', () => {
    const original = m('50');
    expect(Money.of(original)).toBe(original);
  });

  it('rejects a non-finite number', () => {
    expect(() => m(Number.NaN)).toThrow(InvalidMoneyError);
    expect(() => m(Number.POSITIVE_INFINITY)).toThrow(InvalidMoneyError);
  });

  it('rejects a non-numeric string', () => {
    expect(() => m('twelve')).toThrow(InvalidMoneyError);
  });

  it('starts at zero', () => {
    expect(Money.zero().toJSON()).toBe('0.0000');
  });
});

describe('exact decimal arithmetic — the reason this class exists', () => {
  it('adds 0.1 and 0.2 to exactly 0.3', () => {
    // With `number` this is 0.30000000000000004. That single ulp, multiplied
    // across every line of every invoice, is a ledger that does not balance.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(m('0.1').add('0.2').toJSON()).toBe('0.3000');
  });

  it('multiplies a unit price by a quantity without drift', () => {
    // 4903.25 x 3 is a realistic line total.
    expect(m('4903.25').multiply(3).toJSON()).toBe('14709.7500');
  });

  it('computes tax on a line and keeps four decimal places', () => {
    // 12% GST on 1234.5678 — the fractional paisa is kept until the invoice
    // total, where it is rounded once.
    expect(m('1234.5678').multiply('0.12').toJSON()).toBe('148.1481');
  });

  it('sums many small values without accumulating error', () => {
    // A thousand invoices of 0.07. As floats this drifts; as decimals it is exact.
    const values = Array.from({ length: 1_000 }, () => m('0.07'));
    expect(Money.sum(values).toJSON()).toBe('70.0000');
  });

  it('subtracts to exactly zero', () => {
    expect(m('100.0000').subtract('100').toJSON()).toBe('0.0000');
    expect(m('100').subtract('100').isZero()).toBe(true);
  });

  it('returns zero when summing an empty list', () => {
    expect(Money.sum([]).toJSON()).toBe('0.0000');
  });

  it('divides without losing precision at the storage scale', () => {
    expect(m('100').divide(3).roundToStorage().toJSON()).toBe('33.3333');
  });

  it('rejects division by zero', () => {
    expect(() => m('100').divide(0)).toThrow(InvalidMoneyError);
  });
});

describe('rounding', () => {
  it('rounds to storage scale half-up', () => {
    expect(m('1.00005').roundToStorage().toJSON()).toBe('1.0001');
    expect(m('1.00004').roundToStorage().toJSON()).toBe('1.0000');
  });

  it('rounds to display scale half-up', () => {
    expect(m('1.005').roundToCurrency().toJSON()).toBe('1.0100');
    expect(m('1.004').roundToCurrency().toJSON()).toBe('1.0000');
  });

  it('leaves an already-rounded value unchanged', () => {
    expect(m('4903.25').roundToCurrency().toJSON()).toBe('4903.2500');
  });
});

describe('allocation', () => {
  it('splits evenly and preserves the total', () => {
    const parts = m('100').allocate([1, 1, 1]);
    expect(parts).toHaveLength(3);

    // The total must survive: this is the property that matters, not which
    // specific part happens to receive the remainder.
    const total = Money.sum(parts);
    expect(total.toJSON()).toBe('100.0000');
  });

  it('never leaves a part more than one minor unit from another', () => {
    const parts = m('100').allocate([1, 1, 1]);
    const values = parts.map((part) => part.toNumberUnsafe());

    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1 / 10 ** MONEY_SCALE);
  });

  it('distributes proportionally to the weights', () => {
    const parts = m('1000').allocate([70, 30]);
    expect(parts[0]?.toJSON()).toBe('700.0000');
    expect(parts[1]?.toJSON()).toBe('300.0000');
  });

  it('places the remainder with the largest fraction, not the first part', () => {
    // 10 split 3 ways is 3.3333... each with 0.0001 left over. Splitting it
    // naively by always crediting the first part would give a visibly wrong
    // result on a freight allocation shown to a customer.
    const parts = m('10').allocate([1, 1, 1]);
    expect(Money.sum(parts).toJSON()).toBe('10.0000');

    // 100 split 3 ways: 33.3333 + 33.3333 + 33.3334.
    const uneven = m('100').allocate([1, 1, 1]);
    const values = uneven.map((part) => part.toJSON()).sort();
    expect(values).toEqual(['33.3333', '33.3333', '33.3334']);
  });

  it('preserves the total for an awkward prime split', () => {
    // 0.10 across 7 parts: the classic "cannot divide a paisa seven ways" case.
    const parts = m('0.10').allocate([1, 1, 1, 1, 1, 1, 1]);
    expect(Money.sum(parts).toJSON()).toBe('0.1000');
  });

  it('returns zero for each part when every weight is zero', () => {
    const parts = m('100').allocate([0, 0]);
    expect(parts.map((part) => part.toJSON())).toEqual(['0.0000', '0.0000']);
  });

  it('returns an empty array for no weights', () => {
    expect(m('100').allocate([])).toEqual([]);
  });

  it('rejects a negative weight', () => {
    expect(() => m('100').allocate([1, -1])).toThrow(InvalidMoneyError);
  });

  it('preserves the total across many allocations of a value that does not divide evenly', () => {
    // 1/3 of a rupee, split 3 ways, then each part split 3 ways again — the
    // total must still be exactly 1.0000.
    const first = m('1').allocate([1, 1, 1]);
    const second = first.flatMap((part) => part.allocate([1, 1, 1]));
    expect(Money.sum(second).toJSON()).toBe('1.0000');
  });
});

describe('currency safety', () => {
  it('refuses to add two different currencies', () => {
    // Silently adding INR to USD would produce a number that is wrong by a
    // factor of eighty and looks perfectly plausible.
    expect(() => m('100', 'INR').add(m('100', 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('refuses to compare two different currencies', () => {
    expect(() => m('100', 'INR').greaterThan(m('100', 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('converts a Money to a different currency only by explicit construction, which throws', () => {
    expect(() => Money.of(m('100', 'USD'), 'INR')).toThrow(CurrencyMismatchError);
  });

  it('leaves a Money untouched when no currency is requested', () => {
    // The distinction that matters: omitting the currency means "whatever this
    // Money already is", whereas naming one is an explicit request that must be
    // honoured or refused — never silently ignored.
    const usd = m('100', 'USD');
    expect(Money.of(usd)).toBe(usd);
    expect(Money.of(usd, 'USD')).toBe(usd);
  });

  it('allows arithmetic within one currency', () => {
    expect(m('100', 'USD').add(m('50', 'USD')).toJSON()).toBe('150.0000');
  });
});

describe('comparison', () => {
  it('compares by value, not by reference', () => {
    expect(m('100').equals('100')).toBe(true);
    expect(m('100').equals('100.0000')).toBe(true);
    expect(m('100').equals('100.0001')).toBe(false);
  });

  it('orders correctly', () => {
    expect(m('100').greaterThan('99.9999')).toBe(true);
    expect(m('100').lessThan('100.0001')).toBe(true);
    expect(m('100').greaterThanOrEqual('100')).toBe(true);
    expect(m('100').lessThanOrEqual('100')).toBe(true);
    expect(m('100').compareTo('100')).toBe(0);
  });

  it('classifies sign', () => {
    expect(m('0').isZero()).toBe(true);
    expect(m('-1').isNegative()).toBe(true);
    expect(m('1').isPositive()).toBe(true);
  });
});

describe('sign handling', () => {
  it('negates and takes absolute values', () => {
    expect(m('100').negate().toJSON()).toBe('-100.0000');
    expect(m('-100').abs().toJSON()).toBe('100.0000');
  });

  it('keeps a credit note negative through arithmetic', () => {
    // Credit notes are negative amounts; summing them against invoices must
    // net out correctly rather than taking an absolute value somewhere.
    const invoice = m('1000');
    const creditNote = m('-250');
    expect(invoice.add(creditNote).toJSON()).toBe('750.0000');
  });
});

describe('serialisation', () => {
  it('always emits a fixed-scale decimal string', () => {
    // Fixed scale means a client never has to guess whether "100" or "100.00"
    // is coming, and `JSON.parse` cannot silently turn it into a float.
    expect(m('100').toJSON()).toBe('100.0000');
    expect(m('0.5').toJSON()).toBe('0.5000');
  });

  it('serialises inside a larger object without loss', () => {
    const payload = { grandTotal: m('148250.5'), currency: 'INR' };
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      grandTotal: '148250.5000',
      currency: 'INR',
    });
  });

  it('produces a compact display string', () => {
    expect(m('4903.25').toDisplayString()).toBe('4903.25');
    expect(m('4903.2567').toDisplayString()).toBe('4903.26');
  });

  it('round-trips through JSON without changing value', () => {
    const original = m('1234.5678');
    const restored = parseMoney(JSON.parse(JSON.stringify(original)));
    expect(restored.equals(original)).toBe(true);
  });
});

describe('parseMoney — wire input', () => {
  it('accepts a string and a number', () => {
    expect(parseMoney('100.5').toJSON()).toBe('100.5000');
    expect(parseMoney(100.5).toJSON()).toBe('100.5000');
  });

  it('rejects anything else loudly', () => {
    // A silently-zero money value is far more dangerous than a thrown error:
    // an order with a zero total would be accepted and dispatched.
    expect(() => parseMoney(null)).toThrow(InvalidMoneyError);
    expect(() => parseMoney(undefined)).toThrow(InvalidMoneyError);
    expect(() => parseMoney({ amount: 100 })).toThrow(InvalidMoneyError);
    expect(() => parseMoney([])).toThrow(InvalidMoneyError);
  });
});
