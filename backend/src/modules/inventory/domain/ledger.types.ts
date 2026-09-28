import { Quantity } from './quantity.vo';
import { BatchId } from './batch.types';

export type MovementType =
  | 'RECEIPT'
  | 'SALE'
  | 'RETURN'
  | 'ADJUSTMENT'
  | 'RESERVATION'
  | 'RELEASE'
  | 'EXPIRY'
  | 'DAMAGE';

export interface StockLedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly batchId: BatchId;
  readonly type: MovementType;
  readonly quantity: Quantity;
  readonly resultingBalance: Quantity;
  readonly reference: string | null;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface StockLevel {
  readonly productId: string;
  readonly warehouseId: string;
  readonly batchId: BatchId;
  readonly onHand: Quantity;
  readonly reserved: Quantity;
}
