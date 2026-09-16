import { CURRENCY_SCALE, parseMoney } from '@medichain/shared-utils';

/**
 * Renders a `DecimalString` for display.
 *
 * The API sends money as an exact decimal string — see `DecimalString` in
 * `@medichain/shared-types` — so it is parsed with the shared `Money` value object
 * rather than passed to `Number()`, and rounded once, to display scale.
 *
 * `toNumberUnsafe` is the deliberate last step: `Intl.NumberFormat` formats a
 * number, so the two-decimal value is converted to get the grouping and the
 * currency symbol. Nothing downstream of here does arithmetic on the result.
 *
 * One formatter, not one per row: the platform bills in a single currency (INR —
 * see docs/00 §9) and the catalogue does not send a per-product currency.
 */
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: CURRENCY_SCALE,
  maximumFractionDigits: CURRENCY_SCALE,
});

export function formatMoney(value: string): string {
  return INR.format(parseMoney(value).roundToCurrency().toNumberUnsafe());
}
