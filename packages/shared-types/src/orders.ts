import type { DecimalString, OffsetPaginated } from './common';
import type { OrderStatus, PaymentStatus } from './enums';

/** An order as it appears in a list. */
export interface OrderSummary {
  readonly id: string;
  readonly status: OrderStatus;
  readonly total: DecimalString;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

/** One order line, priced as at placement. */
export interface OrderLine {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: DecimalString;
  /** The price the line was placed at — unlike a cart line, this does not move. */
  readonly price: DecimalString;
}

export interface OrderDetail {
  readonly id: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  readonly total: DecimalString;
  readonly items: readonly OrderLine[];
}

export type OrderPage = OffsetPaginated<OrderSummary>;

/** Placement echoes the new order's identity and its priced total. */
export interface OrderPlacementResult {
  readonly id: string;
  readonly total: DecimalString;
}

/** The result of any fulfilment transition: the order and where it now stands. */
export interface OrderTransitionResult {
  readonly id: string;
  readonly status: OrderStatus;
}
