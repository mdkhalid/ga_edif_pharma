import type { DecimalString, OffsetPaginated } from './common';
import type { OrganisationStatus } from './enums';

/**
 * Wire shapes for the credit admin viewer.
 *
 * There is no persisted credit ledger table yet: the authoritative balance
 * today is `Organisation.currentExposure`, maintained transactionally alongside
 * the in-memory ledger in the credit domain. This shape reports that balance,
 * not a reconstructed history.
 */
export interface CreditSummary {
  readonly organisationId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly status: OrganisationStatus;
  readonly creditLimit: DecimalString;
  readonly currentExposure: DecimalString;
  /** `creditLimit - currentExposure`, floored at zero by the caller when shown. */
  readonly availableCredit: DecimalString;
}

export type CreditPage = OffsetPaginated<CreditSummary>;
