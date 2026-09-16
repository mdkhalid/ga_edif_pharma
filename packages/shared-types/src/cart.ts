import type { DecimalString } from './common';

/**
 * One cart line.
 *
 * Pricing is live, not snapshotted: `unitPrice` is read from the product master
 * every time the cart is read, so a price change between adding an item and
 * checking out is reflected rather than silently honoured.
 */
export interface CartLine {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: DecimalString;
  readonly unitPrice: DecimalString;
  readonly lineTotal: DecimalString;
  /**
   * Units available to promise — `quantity − reserved`, summed across every
   * warehouse. A line can exceed it if another organisation reserves stock
   * after the item was added, which is why the cart shows it next to the
   * quantity rather than trusting the quantity alone.
   */
  readonly available: DecimalString;
}

/** The caller organisation's ACTIVE cart. */
export interface CartView {
  readonly id: string;
  readonly items: readonly CartLine[];
  readonly total: DecimalString;
}

export interface AddCartItemResult {
  readonly cartId: string;
}

export interface UpdateCartItemResult {
  readonly productId: string;
}
