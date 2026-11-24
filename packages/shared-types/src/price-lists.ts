import type { DecimalString, OffsetPaginated } from './common';

/** Wire shapes for the price-list admin viewer. */
export type PriceListStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface PriceListLineSummary {
  readonly id: string;
  readonly productId: string;
  readonly productName: string | null;
  readonly minQty: number;
  /** Exact decimal as a string; never route money through a JS float. */
  readonly unitPrice: DecimalString;
}

export interface PriceListSummary {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly status: PriceListStatus;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly lineCount: number;
  readonly customerCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PriceListDetail extends PriceListSummary {
  readonly lines: readonly PriceListLineSummary[];
  readonly customerOrganisationIds: readonly string[];
}

export type PriceListPage = OffsetPaginated<PriceListSummary>;
