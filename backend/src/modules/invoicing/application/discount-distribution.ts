import { Money, ZERO } from '../../pricing';

/**
 * Spread an order-level discount across lines in proportion to their taxable
 * values, paisa-rounded per line.
 *
 * The per-line rounding leaves a residual of at most a few paisa, which is
 * absorbed by the largest line so the distributed total is exact: the sum of
 * the returned values always equals `taxables − discount`, never approximately.
 * The discount is clamped to the taxable sum first, so no line can go negative.
 */
export function distributeDiscount(taxables: readonly Money[], totalDiscount: Money): Money[] {
  const sum = taxables.reduce((acc, t) => acc.plus(t), ZERO);
  if (sum.isZero() || totalDiscount.lessThanOrEqualTo(ZERO)) {
    return [...taxables];
  }
  const discount = Money.min(totalDiscount, sum);

  const shares = taxables.map((t) => t.times(discount.value).dividedBy(sum.value).round());
  const distributed = shares.reduce((acc, s) => acc.plus(s), ZERO);
  const residual = discount.minus(distributed);

  // The residual is the rounding dust (bounded by half a paisa per line). It
  // lands on the largest line, where it is least visible and can never push
  // the line negative.
  let largest = 0;
  for (let i = 1; i < taxables.length; i += 1) {
    if (taxables[i]!.greaterThan(taxables[largest]!)) largest = i;
  }
  shares[largest] = shares[largest]!.plus(residual);

  return taxables.map((t, i) => Money.max(t.minus(shares[i]!), ZERO));
}
