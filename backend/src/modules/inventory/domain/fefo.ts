import { Quantity, ZERO_QTY } from './quantity.vo';
import { Batch, BatchId } from './batch.types';
import { StockLedger } from './stock-ledger';

export interface FefoAllocation {
  readonly batchId: BatchId;
  readonly allocated: Quantity;
  readonly batchNumber: string;
  readonly expiryDate: Date | null;
}

export interface FefoResult {
  readonly allocations: FefoAllocation[];
  readonly totalAllocated: Quantity;
  readonly shortfall: Quantity;
}

/**
 * First-Expired-First-Out (FEFO) allocation.
 *
 * Allocates requested quantity across available batches, consuming from the
 * batch with the earliest expiry date first. Batches with no expiry date are
 * treated as expiring last (they get consumed last).
 *
 * This is a pure function — it reads the ledger's current state but does not
 * mutate it. The caller is responsible for appending the corresponding
 * SALE/RESERVATION entries to the ledger.
 */
export function allocateFefo(
  ledger: StockLedger,
  productId: string,
  warehouseId: string,
  batches: readonly Batch[],
  requested: Quantity,
): FefoResult {
  if (requested.isZero() || requested.isNegative()) {
    return { allocations: [], totalAllocated: ZERO_QTY, shortfall: requested };
  }

  const today = new Date();
  const eligibleBatches = batches
    .filter((b) => b.productId === productId && b.warehouseId === warehouseId)
    .filter((b) => b.expiryDate === null || b.expiryDate > today)
    .sort((a, b) => {
      if (a.expiryDate === null && b.expiryDate === null) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate.getTime() - b.expiryDate.getTime();
    });

  const allocations: FefoAllocation[] = [];
  let remaining = requested;
  let totalAllocated = ZERO_QTY;

  for (const batch of eligibleBatches) {
    if (remaining.isZero()) break;

    const available = ledger.available(productId, warehouseId, batch.id);
    if (available.isZero()) continue;

    const allocate = available.lessThan(remaining) ? available : remaining;
    remaining = remaining.minus(allocate);
    totalAllocated = totalAllocated.plus(allocate);

    allocations.push({
      batchId: batch.id,
      allocated: allocate,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
    });
  }

  return {
    allocations,
    totalAllocated,
    shortfall: remaining,
  };
}
