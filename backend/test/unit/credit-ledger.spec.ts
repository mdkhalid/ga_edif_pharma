import { Money } from '../../src/modules/pricing/domain/money.vo';
import {
  CreditLedger,
  CreditLimitExceededError,
  AppendCreditEntryInput,
} from '../../src/modules/credit/domain/credit-ledger';

const TENANT = 'T1';
const ORG = 'O1';

function grant(id: string, amount: number, createdAt = new Date('2026-01-01')): AppendCreditEntryInput {
  return { id, tenantId: TENANT, organisationId: ORG, type: 'LIMIT_GRANT', amount: new Money(amount), createdAt };
}

function hold(id: string, amount: number, createdAt = new Date('2026-01-02')): AppendCreditEntryInput {
  return { id, tenantId: TENANT, organisationId: ORG, type: 'HOLD', amount: new Money(amount), createdAt };
}

function release(id: string, amount: number, createdAt = new Date('2026-01-03')): AppendCreditEntryInput {
  return { id, tenantId: TENANT, organisationId: ORG, type: 'RELEASE', amount: new Money(amount), createdAt };
}

function consume(id: string, amount: number, createdAt = new Date('2026-01-04')): AppendCreditEntryInput {
  return { id, tenantId: TENANT, organisationId: ORG, type: 'CONSUME', amount: new Money(amount), createdAt };
}

function payment(id: string, amount: number, createdAt = new Date('2026-01-05')): AppendCreditEntryInput {
  return { id, tenantId: TENANT, organisationId: ORG, type: 'PAYMENT', amount: new Money(amount), createdAt };
}

describe('CreditLedger — balance tracking', () => {
  it('starts with zero balance', () => {
    const ledger = new CreditLedger();
    expect(ledger.currentBalance(ORG).isZero()).toBe(true);
  });

  it('tracks balance after a limit grant', () => {
    const ledger = new CreditLedger().append(grant('E1', 10000));
    expect(ledger.currentBalance(ORG).equals(new Money(10000))).toBe(true);
  });

  it('tracks balance after grant then consume', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append(consume('E2', 3000));
    expect(ledger.currentBalance(ORG).equals(new Money(7000))).toBe(true);
  });

  it('is immutable — append returns a new instance', () => {
    const l1 = new CreditLedger();
    const l2 = l1.append(grant('E1', 5000));
    expect(l1).not.toBe(l2);
    expect(l1.entries).toHaveLength(0);
    expect(l2.entries).toHaveLength(1);
  });

  it('tracks balances independently per organisation', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append({ ...grant('E2', 5000), organisationId: 'O2' });
    expect(ledger.currentBalance(ORG).equals(new Money(10000))).toBe(true);
    expect(ledger.currentBalance('O2').equals(new Money(5000))).toBe(true);
  });
});

describe('CreditLedger — holds', () => {
  it('tracks total held', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append(hold('E2', 3000));
    expect(ledger.totalHeld(ORG).equals(new Money(3000))).toBe(true);
  });

  it('release reduces held amount', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append(hold('E2', 3000))
      .append(release('E3', 1000));
    expect(ledger.totalHeld(ORG).equals(new Money(2000))).toBe(true);
  });

  it('available credit = limit - consumed - held', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append(hold('E2', 2000))
      .append(consume('E3', 1000));
    const limit = new Money(10000);
    expect(ledger.availableCredit(ORG, limit).equals(new Money(7000))).toBe(true);
  });

  it('available credit clamps to zero when over-extended', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append(hold('E2', 8000))
      .append(consume('E3', 3000));
    const limit = new Money(10000);
    expect(ledger.availableCredit(ORG, limit).isZero()).toBe(true);
  });

  it('available credit clamps to zero when over-extended', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append(hold('E2', 8000))
      .append(consume('E3', 3000));
    const limit = new Money(10000);
    expect(ledger.availableCredit(ORG, limit).isZero()).toBe(true);
  });

  it('payment increases available credit', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append(consume('E2', 5000))
      .append(payment('E3', 2000));
    expect(ledger.currentBalance(ORG).equals(new Money(7000))).toBe(true);
  });
});

describe('CreditLedger — limit enforcement', () => {
  it('throws when consume exceeds balance', () => {
    const ledger = new CreditLedger().append(grant('E1', 1000));
    expect(() => ledger.append(consume('E2', 2000))).toThrow(CreditLimitExceededError);
  });

  it('throws when hold exceeds balance', () => {
    const ledger = new CreditLedger().append(grant('E1', 1000));
    expect(() => ledger.append(hold('E2', 2000))).toThrow(CreditLimitExceededError);
  });

  it('allows consume up to exact balance', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 1000))
      .append(consume('E2', 1000));
    expect(ledger.currentBalance(ORG).isZero()).toBe(true);
  });
});

describe('CreditLedger — invariant', () => {
  it('verifyInvariant holds for grant + consume + payment', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append(consume('E2', 3000))
      .append(payment('E3', 1000));
    expect(ledger.verifyInvariant()).toBe(true);
  });

  it('verifyInvariant holds across multiple organisations', () => {
    const ledger = new CreditLedger()
      .append(grant('E1', 10000))
      .append({ ...grant('E2', 5000), organisationId: 'O2' })
      .append(consume('E3', 2000))
      .append({ ...consume('E4', 1000), organisationId: 'O2' });
    expect(ledger.verifyInvariant()).toBe(true);
  });
});

describe('CreditLedger — property test (seeded)', () => {
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

  it('holds invariants across 2000 random grant/consume/payment sequences', () => {
    const rand = mulberry32(0xcafebabe);

    for (let iter = 0; iter < 2000; iter++) {
      let ledger = new CreditLedger();
      const nOps = 1 + Math.floor(rand() * 20);
      let expectedBalance = new Money(0);

      for (let op = 0; op < nOps; op++) {
        const amount = new Money(1 + Math.floor(rand() * 5000));
        const roll = rand();

        if (roll < 0.4) {
          ledger = ledger.append(grant(`E${op}`, Number(amount.toString())));
          expectedBalance = expectedBalance.plus(amount);
        } else if (roll < 0.7) {
          if (expectedBalance.greaterThanOrEqualTo(amount)) {
            ledger = ledger.append(consume(`E${op}`, Number(amount.toString())));
            expectedBalance = expectedBalance.minus(amount);
          }
        } else {
          ledger = ledger.append(payment(`E${op}`, Number(amount.toString())));
          expectedBalance = expectedBalance.plus(amount);
        }
      }

      expect(ledger.verifyInvariant()).toBe(true);
      expect(ledger.currentBalance(ORG).equals(expectedBalance)).toBe(true);
    }
  });
});
