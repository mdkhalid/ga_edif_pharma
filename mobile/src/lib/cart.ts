/**
 * Cart quantity input rules, kept pure so they can be tested without a device.
 *
 * The server owns pricing and stock; this helper only decides whether a string
 * typed into a text field is a usable quantity. It deliberately rejects zero,
 * negatives and non-finite values — a "quantity" of -2 would turn a cart line
 * into a credit if it ever reached the API.
 */
export function parseQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}
