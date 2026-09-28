import { Money } from '../../pricing/domain/money.vo';

export type CreditMovementType =
  | 'LIMIT_GRANT'
  | 'LIMIT_REDUCTION'
  | 'HOLD'
  | 'RELEASE'
  | 'CONSUME'
  | 'PAYMENT'
  | 'ADJUSTMENT';

export interface CreditLedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly type: CreditMovementType;
  readonly amount: Money;
  readonly resultingBalance: Money;
  readonly reference: string | null;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export class CreditLimitExceededError extends Error {
  constructor(
    public readonly organisationId: string,
    public readonly requested: Money,
    public readonly available: Money,
  ) {
    super(
      `Credit limit exceeded for organisation ${organisationId}: requested ${requested.toString()}, available ${available.toString()}`,
    );
    this.name = 'CreditLimitExceededError';
  }
}

export class InsufficientHoldError extends Error {
  constructor(
    public readonly organisationId: string,
    public readonly requested: Money,
    public readonly held: Money,
  ) {
    super(
      `Insufficient hold for organisation ${organisationId}: requested ${requested.toString()}, held ${held.toString()}`,
    );
    this.name = 'InsufficientHoldError';
  }
}

export interface AppendCreditEntryInput {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly type: CreditMovementType;
  readonly amount: Money;
  readonly reference?: string;
  readonly reason?: string;
  readonly createdAt: Date;
}

function isDebitType(type: CreditMovementType): boolean {
  return type === 'CONSUME' || type === 'LIMIT_REDUCTION';
}

function isBalanceAffecting(type: CreditMovementType): boolean {
  return type !== 'HOLD' && type !== 'RELEASE';
}

export class CreditLedger {
  private readonly _entries: CreditLedgerEntry[];

  constructor(entries: readonly CreditLedgerEntry[] = []) {
    this._entries = [...entries];
  }

  get entries(): readonly CreditLedgerEntry[] {
    return Object.freeze([...this._entries]);
  }

  append(input: AppendCreditEntryInput): CreditLedger {
    const isDebit = isDebitType(input.type);
    const isHold = input.type === 'HOLD';
    const current = this.currentBalance(input.organisationId);
    const held = this.totalHeld(input.organisationId);

    if (isHold) {
      const available = current.minus(held);
      if (input.amount.greaterThan(available)) {
        throw new CreditLimitExceededError(
          input.organisationId,
          input.amount,
          available,
        );
      }
    }

    const resulting = isDebit
      ? current.minus(input.amount)
      : current.plus(input.amount);

    if (!isHold && resulting.isNegative()) {
      throw new CreditLimitExceededError(
        input.organisationId,
        input.amount,
        current,
      );
    }

    const entry: CreditLedgerEntry = {
      id: input.id,
      tenantId: input.tenantId,
      organisationId: input.organisationId,
      type: input.type,
      amount: input.amount,
      resultingBalance: resulting,
      reference: input.reference ?? null,
      reason: input.reason ?? null,
      createdAt: input.createdAt,
    };

    return new CreditLedger([...this._entries, entry]);
  }

  currentBalance(organisationId: string): Money {
    return this._entries
      .filter((e) => e.organisationId === organisationId && isBalanceAffecting(e.type))
      .reduce((sum, e) => {
        const isDebit = isDebitType(e.type);
        return isDebit ? sum.minus(e.amount) : sum.plus(e.amount);
      }, new Money(0));
  }

  consumedBalance(organisationId: string): Money {
    return this._entries
      .filter((e) => e.organisationId === organisationId && e.type === 'CONSUME')
      .reduce((sum, e) => sum.plus(e.amount), new Money(0));
  }

  totalHeld(organisationId: string): Money {
    const held = this._entries
      .filter((e) => e.organisationId === organisationId && e.type === 'HOLD')
      .reduce((sum, e) => sum.plus(e.amount), new Money(0));
    const released = this._entries
      .filter((e) => e.organisationId === organisationId && e.type === 'RELEASE')
      .reduce((sum, e) => sum.plus(e.amount), new Money(0));
    const net = held.minus(released);
    return net.isNegative() ? new Money(0) : net;
  }

  availableCredit(organisationId: string, limit: Money): Money {
    const consumed = this.consumedBalance(organisationId);
    const held = this.totalHeld(organisationId);
    const avail = limit.minus(consumed).minus(held);
    return avail.isNegative() ? new Money(0) : avail;
  }

  verifyInvariant(): boolean {
    const orgIds = new Set(this._entries.map((e) => e.organisationId));
    for (const orgId of orgIds) {
      const sum = this._entries
        .filter((e) => e.organisationId === orgId)
        .reduce((acc, e) => {
          const isDebit = isDebitType(e.type);
          return isDebit ? acc.minus(e.amount) : acc.plus(e.amount);
        }, new Money(0));
      if (!sum.equals(this.currentBalance(orgId))) return false;
    }
    return true;
  }
}
