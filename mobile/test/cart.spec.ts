import { parseQuantity } from '../src/lib/cart';

describe('parseQuantity', () => {
  it.each(['1', ' 2 ', '0.5', '12.75'])('accepts %s', (raw) => {
    expect(parseQuantity(raw)).toBe(Number(raw));
  });

  it.each(['', '   ', 'abc', '0', '-1', 'Infinity', 'NaN'])('rejects %s', (raw) => {
    expect(parseQuantity(raw)).toBeNull();
  });
});
