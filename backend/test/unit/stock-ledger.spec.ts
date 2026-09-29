import { Quantity, ZERO_QTY } from '../../src/modules/inventory/domain/quantity.vo';
import { Batch } from '../../src/modules/inventory/domain/batch.types';
import { StockLedger, InsufficientStockError, AppendEntryInput } from '../../src/modules/inventory/domain/stock-ledger';
import { allocateFefo } from '../../src/modules/inventory/domain/fefo';

const TENANT = 'T1';
const PRODUCT = 'P1';
const WAREHOUSE = 'W1';

function receipt(id: string, qty: number, batchId = 'B1', createdAt = new Date('2026-01-01')): AppendEntryInput {
  return {
    id,
    tenantId: TENANT,
    productId: PRODUCT,
    warehouseId: WAREHOUSE,
    batchId,
    type: 'RECEIPT',
    quantity: new Quantity(qty),
    createdAt,
  };
}

function sale(id: string, qty: number, batchId = 'B1', createdAt = new Date('2026-01-02')): AppendEntryInput {
  return {
    id,
    tenantId: TENANT,
    productId: PRODUCT,
    warehouseId: WAREHOUSE,
    batchId,
    type: 'SALE',
    quantity: new Quantity(qty),
    createdAt,
  };
}

function reservation(id: string, qty: number, batchId = 'B1', createdAt = new Date('2026-01-03')): AppendEntryInput {
  return {
    id,
    tenantId: TENANT,
    productId: PRODUCT,
    warehouseId: WAREHOUSE,
    batchId,
    type: 'RESERVATION',
    quantity: new Quantity(qty),
    createdAt,
  };
}

function release(id: string, qty: number, batchId = 'B1', createdAt = new Date('2026-01-04')): AppendEntryInput {
  return {
    id,
    tenantId: TENANT,
    productId: PRODUCT,
    warehouseId: WAREHOUSE,
    batchId,
    type: 'RELEASE',
    quantity: new Quantity(qty),
    createdAt,
  };
}

function makeBatch(id: string, expiryDate: Date | null): Batch {
  return {
    id,
    productId: PRODUCT,
    warehouseId: WAREHOUSE,
    batchNumber: `BN-${id}`,
    expiryDate,
    manufacturedDate: null,
  };
}

describe('StockLedger — append and balance', () => {
  it('starts with zero balance for unknown product/warehouse/batch', () => {
    const ledger = new StockLedger();
    expect(ledger.currentBalance(PRODUCT, WAREHOUSE, 'B1').isZero()).toBe(true);
  });

  it('tracks balance after a receipt', () => {
    const ledger = new StockLedger().append(receipt('E1', 100));
    expect(ledger.currentBalance(PRODUCT, WAREHOUSE, 'B1').equals(new Quantity(100))).toBe(true);
  });

  it('tracks balance after receipt then sale', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100))
      .append(sale('E2', 30));
    expect(ledger.currentBalance(PRODUCT, WAREHOUSE, 'B1').equals(new Quantity(70))).toBe(true);
  });

  it('is immutable — append returns a new instance', () => {
    const ledger1 = new StockLedger();
    const ledger2 = ledger1.append(receipt('E1', 50));
    expect(ledger1).not.toBe(ledger2);
    expect(ledger1.entries).toHaveLength(0);
    expect(ledger2.entries).toHaveLength(1);
  });

  it('tracks balances independently per batch', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100, 'B1'))
      .append(receipt('E2', 200, 'B2'));
    expect(ledger.currentBalance(PRODUCT, WAREHOUSE, 'B1').equals(new Quantity(100))).toBe(true);
    expect(ledger.currentBalance(PRODUCT, WAREHOUSE, 'B2').equals(new Quantity(200))).toBe(true);
  });

  it('tracks balances independently per warehouse', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100, 'B1'))
      .append({
        ...receipt('E2', 50, 'B1'),
        warehouseId: 'W2',
      });
    expect(ledger.currentBalance(PRODUCT, 'W1', 'B1').equals(new Quantity(100))).toBe(true);
    expect(ledger.currentBalance(PRODUCT, 'W2', 'B1').equals(new Quantity(50))).toBe(true);
  });
});

describe('StockLedger — invariant', () => {
  it('verifyInvariant holds for a simple receipt + sale sequence', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100))
      .append(sale('E2', 30))
      .append(sale('E3', 20));
    expect(ledger.verifyInvariant()).toBe(true);
  });

  it('verifyInvariant holds across multiple batches', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100, 'B1'))
      .append(receipt('E2', 200, 'B2'))
      .append(sale('E3', 50, 'B1'))
      .append(sale('E4', 75, 'B2'));
    expect(ledger.verifyInvariant()).toBe(true);
  });
});

describe('StockLedger — insufficient stock', () => {
  it('throws InsufficientStockError when sale exceeds balance', () => {
    const ledger = new StockLedger().append(receipt('E1', 10));
    expect(() => ledger.append(sale('E2', 20))).toThrow(InsufficientStockError);
  });

  it('throws InsufficientStockError when reservation exceeds available', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 10))
      .append(reservation('E2', 8));
    expect(() => ledger.append(reservation('E3', 5))).toThrow(InsufficientStockError);
  });

  it('allows sale up to exact balance', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 10))
      .append(sale('E2', 10));
    expect(ledger.currentBalance(PRODUCT, WAREHOUSE, 'B1').isZero()).toBe(true);
  });
});

describe('StockLedger — reservations', () => {
  it('tracks reserved quantity separately from on-hand', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100))
      .append(reservation('E2', 30));
    expect(ledger.currentBalance(PRODUCT, WAREHOUSE, 'B1').equals(new Quantity(100))).toBe(true);
    expect(ledger.reservedQuantity(PRODUCT, WAREHOUSE, 'B1').equals(new Quantity(30))).toBe(true);
  });

  it('available = on-hand minus reserved', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100))
      .append(reservation('E2', 30));
    expect(ledger.available(PRODUCT, WAREHOUSE, 'B1').equals(new Quantity(70))).toBe(true);
  });

  it('release reduces reserved quantity', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100))
      .append(reservation('E2', 30))
      .append(release('E3', 10));
    expect(ledger.reservedQuantity(PRODUCT, WAREHOUSE, 'B1').equals(new Quantity(20))).toBe(true);
    expect(ledger.available(PRODUCT, WAREHOUSE, 'B1').equals(new Quantity(80))).toBe(true);
  });

  it('does not allow reservation beyond available', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 10))
      .append(reservation('E2', 8));
    expect(() => ledger.append(reservation('E3', 5))).toThrow(InsufficientStockError);
  });
});

describe('StockLedger — stock levels', () => {
  it('returns stock levels for all batches of a product/warehouse', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100, 'B1'))
      .append(receipt('E2', 200, 'B2'))
      .append(reservation('E3', 30, 'B1'));
    const levels = ledger.stockLevels(PRODUCT, WAREHOUSE);
    expect(levels).toHaveLength(2);
    const b1 = levels.find((l) => l.batchId === 'B1')!;
    const b2 = levels.find((l) => l.batchId === 'B2')!;
    expect(b1.onHand.equals(new Quantity(100))).toBe(true);
    expect(b1.reserved.equals(new Quantity(30))).toBe(true);
    expect(b2.onHand.equals(new Quantity(200))).toBe(true);
    expect(b2.reserved.isZero()).toBe(true);
  });
});

describe('allocateFefo — FEFO allocation', () => {
  it('allocates from earliest-expiring batch first', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 50, 'B1'))
      .append(receipt('E2', 50, 'B2'));

    const batches: Batch[] = [
      makeBatch('B1', new Date('2027-06-01')),
      makeBatch('B2', new Date('2027-01-01')),
    ];

    const result = allocateFefo(ledger, PRODUCT, WAREHOUSE, batches, new Quantity(60));

    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0]!.batchId).toBe('B2');
    expect(result.allocations[0]!.allocated.equals(new Quantity(50))).toBe(true);
    expect(result.allocations[1]!.batchId).toBe('B1');
    expect(result.allocations[1]!.allocated.equals(new Quantity(10))).toBe(true);
    expect(result.totalAllocated.equals(new Quantity(60))).toBe(true);
    expect(result.shortfall.isZero()).toBe(true);
  });

  it('returns shortfall when total available is less than requested', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 30, 'B1'));

    const batches: Batch[] = [makeBatch('B1', new Date('2027-01-01'))];

    const result = allocateFefo(ledger, PRODUCT, WAREHOUSE, batches, new Quantity(50));

    expect(result.allocations).toHaveLength(1);
    expect(result.totalAllocated.equals(new Quantity(30))).toBe(true);
    expect(result.shortfall.equals(new Quantity(20))).toBe(true);
  });

  it('skips expired batches', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 50, 'B1'))
      .append(receipt('E2', 50, 'B2'));

    const batches: Batch[] = [
      makeBatch('B1', new Date('2020-01-01')),
      makeBatch('B2', new Date('2027-01-01')),
    ];

    const result = allocateFefo(ledger, PRODUCT, WAREHOUSE, batches, new Quantity(30));

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.batchId).toBe('B2');
    expect(result.allocations[0]!.allocated.equals(new Quantity(30))).toBe(true);
  });

  it('treats batches with no expiry as expiring last', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 50, 'B1'))
      .append(receipt('E2', 50, 'B2'));

    const batches: Batch[] = [
      makeBatch('B1', null),
      makeBatch('B2', new Date('2027-01-01')),
    ];

    const result = allocateFefo(ledger, PRODUCT, WAREHOUSE, batches, new Quantity(60));

    expect(result.allocations[0]!.batchId).toBe('B2');
    expect(result.allocations[1]!.batchId).toBe('B1');
  });

  it('respects reservations when computing available', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 100, 'B1'))
      .append(reservation('E2', 80, 'B1'));

    const batches: Batch[] = [makeBatch('B1', new Date('2027-01-01'))];

    const result = allocateFefo(ledger, PRODUCT, WAREHOUSE, batches, new Quantity(50));

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.allocated.equals(new Quantity(20))).toBe(true);
    expect(result.shortfall.equals(new Quantity(30))).toBe(true);
  });

  it('returns empty allocations for zero requested quantity', () => {
    const ledger = new StockLedger().append(receipt('E1', 50, 'B1'));
    const batches: Batch[] = [makeBatch('B1', new Date('2027-01-01'))];

    const result = allocateFefo(ledger, PRODUCT, WAREHOUSE, batches, ZERO_QTY);

    expect(result.allocations).toHaveLength(0);
    expect(result.totalAllocated.isZero()).toBe(true);
  });

  it('allocates across many batches in correct FEFO order', () => {
    const ledger = new StockLedger()
      .append(receipt('E1', 10, 'B1'))
      .append(receipt('E2', 20, 'B2'))
      .append(receipt('E3', 30, 'B3'))
      .append(receipt('E4', 40, 'B4'));

    const batches: Batch[] = [
      makeBatch('B1', new Date('2027-03-01')),
      makeBatch('B2', new Date('2027-01-01')),
      makeBatch('B3', new Date('2027-06-01')),
      makeBatch('B4', new Date('2027-02-01')),
    ];

    const result = allocateFefo(ledger, PRODUCT, WAREHOUSE, batches, new Quantity(55));

    expect(result.allocations.map((a) => a.batchId)).toEqual(['B2', 'B4']);
    expect(result.allocations[0]!.allocated.equals(new Quantity(20))).toBe(true);
    expect(result.allocations[1]!.allocated.equals(new Quantity(35))).toBe(true);
    expect(result.totalAllocated.equals(new Quantity(55))).toBe(true);
    expect(result.shortfall.isZero()).toBe(true);
  });
});

describe('StockLedger — property test (seeded)', () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('holds invariants across 2000 random receipt/sale sequences', () => {
    const rand = mulberry32(0xdeadbeef);

    for (let iter = 0; iter < 2000; iter++) {
      let ledger = new StockLedger();
      const nOps = 1 + Math.floor(rand() * 20);
      let expectedBalance = ZERO_QTY;

      for (let op = 0; op < nOps; op++) {
        const qty = 1 + Math.floor(rand() * 50);
        const isReceipt = rand() < 0.5;

        if (isReceipt) {
          ledger = ledger.append(receipt(`E${op}`, qty));
          expectedBalance = expectedBalance.plus(new Quantity(qty));
        } else {
          if (expectedBalance.greaterThanOrEqualTo(new Quantity(qty))) {
            ledger = ledger.append(sale(`E${op}`, qty));
            expectedBalance = expectedBalance.minus(new Quantity(qty));
          }
        }
      }

      expect(ledger.verifyInvariant()).toBe(true);
      expect(ledger.currentBalance(PRODUCT, WAREHOUSE, 'B1').equals(expectedBalance)).toBe(true);
    }
  });
});
