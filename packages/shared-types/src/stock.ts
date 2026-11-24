import type { DecimalString, OffsetPaginated } from './common';

/** Wire shapes for the stock admin viewer. */

export interface StockSummary {
  readonly id: string;
  readonly productId: string;
  readonly productName: string | null;
  readonly warehouseId: string;
  readonly batchId: string | null;
  readonly expiryDate: string | null;
  readonly quantity: DecimalString;
  readonly reserved: DecimalString;
  /** `quantity - reserved`, computed in the database's decimal arithmetic. */
  readonly available: DecimalString;
}

export type StockPage = OffsetPaginated<StockSummary>;
