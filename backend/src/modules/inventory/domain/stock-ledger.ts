import Decimal from 'decimal.js';
import { Quantity, ZERO_QTY } from './quantity.vo';
import { BatchId } from './batch.types';
import { StockLedgerEntry, StockLevel, MovementType } from './ledger.types';

export interface AppendEntryInput {
  readonly id: string;
  readonly tenantId: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly batchId: BatchId;
  readonly type: MovementType;
  readonly quantity: Quantity;
  readonly reference?: string;
  readonly reason?: string;
  readonly createdAt: Date;
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly productId: string,
    public readonly warehouseId: string,
    public readonly batchId: BatchId,
    public readonly requested: Quantity,
    public readonly available: Quantity,
  ) {
    super(
      `Insufficient stock for product ${productId} in warehouse ${warehouseId}, batch ${batchId}: requested ${requested.toString()}, available ${available.toString()}`,
    );
    this.name = 'InsufficientStockError';
  }
}

export class InvalidLedgerEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLedgerEntryError';
  }
}

/**
 * Pure, append-only stock ledger.
 *
 * The ledger is the single source of truth for stock levels. Entries are never
 * modified or deleted — corrections are made by appending offsetting entries.
 * The invariant `sum(entries) = stock_on_hand` must always hold.
 */
export class StockLedger {
  private readonly _entries: StockLedgerEntry[];

  constructor(entries: readonly StockLedgerEntry[] = []) {
    this._entries = [...entries];
  }

  get entries(): readonly StockLedgerEntry[] {
    return Object.freeze([...this._entries]);
  }

  /**
   * Append a new ledger entry. Returns a NEW StockLedger instance (immutable).
   * Validates that the resulting balance never goes negative for SALE/RESERVATION/EXPIRY/DAMAGE.
   */
  append(input: AppendEntryInput): StockLedger {
    const isDebit = this.isDebitType(input.type);
    const isReservation = input.type === 'RESERVATION';
    const isRelease = input.type === 'RELEASE';

    const currentBalance = this.currentBalance(input.productId, input.warehouseId, input.batchId);
    const reserved = this.reservedQuantity(input.productId, input.warehouseId, input.batchId);
    const available = currentBalance.minus(reserved);

    const balanceForCheck = isReservation ? available : currentBalance;

    if (isReservation && input.quantity.greaterThan(available)) {
      throw new InsufficientStockError(
        input.productId,
        input.warehouseId,
        input.batchId,
        input.quantity,
        available,
      );
    }

    let resultingBalance: Quantity;
    if (isReservation || isRelease) {
      resultingBalance = currentBalance;
    } else {
      resultingBalance = isDebit
        ? balanceForCheck.minus(input.quantity)
        : balanceForCheck.plus(input.quantity);
    }

    if (resultingBalance.isNegative()) {
      throw new InsufficientStockError(
        input.productId,
        input.warehouseId,
        input.batchId,
        input.quantity,
        balanceForCheck,
      );
    }

    const entry: StockLedgerEntry = {
      id: input.id,
      tenantId: input.tenantId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      batchId: input.batchId,
      type: input.type,
      quantity: input.quantity,
      resultingBalance,
      reference: input.reference ?? null,
      reason: input.reason ?? null,
      createdAt: input.createdAt,
    };

    return new StockLedger([...this._entries, entry]);
  }

  /**
   * Current stock on hand for a product/warehouse/batch combination.
   * Sum of all ledger entries (receipts are positive, sales are negative).
   */
  currentBalance(productId: string, warehouseId: string, batchId: BatchId): Quantity {
    return this._entries
      .filter(
        (e) =>
          e.productId === productId &&
          e.warehouseId === warehouseId &&
          e.batchId === batchId &&
          e.type !== 'RESERVATION' &&
          e.type !== 'RELEASE',
      )
      .reduce((sum, e) => {
        const isDebit = this.isDebitType(e.type);
        return isDebit ? sum.minus(e.quantity) : sum.plus(e.quantity);
      }, ZERO_QTY);
  }

  /**
   * Reserved quantity for a product/warehouse/batch.
   */
  reservedQuantity(productId: string, warehouseId: string, batchId: BatchId): Quantity {
    return this._entries
      .filter(
        (e) =>
          e.productId === productId &&
          e.warehouseId === warehouseId &&
          e.batchId === batchId &&
          e.type === 'RESERVATION',
      )
      .reduce((sum, e) => sum.plus(e.quantity), ZERO_QTY)
      .minus(
        this._entries
          .filter(
            (e) =>
              e.productId === productId &&
              e.warehouseId === warehouseId &&
              e.batchId === batchId &&
              e.type === 'RELEASE',
          )
          .reduce((sum, e) => sum.plus(e.quantity), ZERO_QTY),
      );
  }

  /**
   * Available to promise = on hand - reserved.
   */
  available(productId: string, warehouseId: string, batchId: BatchId): Quantity {
    const onHand = this.currentBalance(productId, warehouseId, batchId);
    const reserved = this.reservedQuantity(productId, warehouseId, batchId);
    const avail = onHand.minus(reserved);
    return avail.isNegative() ? ZERO_QTY : avail;
  }

  /**
   * Aggregate stock levels across all batches for a product/warehouse.
   */
  stockLevels(productId: string, warehouseId: string): StockLevel[] {
    const batchIds = new Set(
      this._entries
        .filter((e) => e.productId === productId && e.warehouseId === warehouseId)
        .map((e) => e.batchId),
    );

    return [...batchIds].map((batchId) => ({
      productId,
      warehouseId,
      batchId,
      onHand: this.currentBalance(productId, warehouseId, batchId),
      reserved: this.reservedQuantity(productId, warehouseId, batchId),
    }));
  }

  /**
   * Verify the invariant: sum of all entries equals current balance.
   */
  verifyInvariant(): boolean {
    const keys = new Set(
      this._entries.map((e) => `${e.productId}|${e.warehouseId}|${e.batchId}`),
    );

    for (const key of keys) {
      const [productId, warehouseId, batchId] = key.split('|') as [string, string, BatchId];
      const sum = this._entries
        .filter(
          (e) =>
            e.productId === productId &&
            e.warehouseId === warehouseId &&
            e.batchId === batchId,
        )
        .reduce((acc, e) => {
          const isDebit = this.isDebitType(e.type);
          return isDebit ? acc.minus(e.quantity) : acc.plus(e.quantity);
        }, ZERO_QTY);

      const expected = this.currentBalance(productId, warehouseId, batchId);
      if (!sum.equals(expected)) {
        return false;
      }
    }
    return true;
  }

  private isDebitType(type: MovementType): boolean {
    return type === 'SALE' || type === 'EXPIRY' || type === 'DAMAGE';
  }
}
