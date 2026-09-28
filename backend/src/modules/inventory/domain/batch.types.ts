export type BatchId = string;

export interface Batch {
  readonly id: BatchId;
  readonly productId: string;
  readonly warehouseId: string;
  readonly batchNumber: string;
  readonly expiryDate: Date | null;
  readonly manufacturedDate: Date | null;
}
