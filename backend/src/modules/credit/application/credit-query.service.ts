import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@prisma/client/runtime/library';

import type { CreditPage, CreditSummary } from '@medichain/shared-types';

import { NotFoundError } from '../../../common/exceptions/domain.exception';
import { buildOffsetMeta, resolveOffset } from '../../../common/utils/pagination.util';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import type { ListCreditQuery } from '../api/dto/credit.dto';

/**
 * Read model for customer credit (P11).
 *
 * There is no persisted credit-ledger table yet, so the authoritative figures
 * available today are the organisation's credit limit and its transactionally
 * maintained `currentExposure`. The in-memory `CreditLedger` in the domain layer
 * floors available credit at zero; this read model does the same so the viewer
 * never disagrees with the domain rule.
 */
@Injectable()
export class CreditQueryService {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async list(_tenantId: string, query: ListCreditQuery): Promise<CreditPage> {
    const resolved = resolveOffset(query.page, query.pageSize);
    const search = query.search?.trim() ?? '';
    const where = {
      deletedAt: null,
      ...(query.status !== undefined ? { status: query.status as never } : {}),
      ...(search !== ''
        ? {
            OR: [
              { legalName: { contains: search, mode: 'insensitive' as const } },
              { tradeName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.organisation.findMany({
        where,
        orderBy: [{ legalName: 'asc' }],
        skip: resolved.skip,
        take: resolved.take,
      }),
      this.prisma.organisation.count({ where }),
    ]);

    return {
      data: rows.map((row) => toSummary(row)),
      meta: buildOffsetMeta(total, resolved),
    };
  }

  async getById(_tenantId: string, organisationId: string): Promise<CreditSummary> {
    const row = await this.prisma.organisation.findFirst({
      where: { id: organisationId, deletedAt: null },
    });
    if (row === null) throw new NotFoundError('Organisation not found.');
    return toSummary(row);
  }
}

interface OrganisationCreditRow {
  readonly id: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly status: CreditSummary['status'];
  readonly creditLimit: Decimal;
  readonly currentExposure: Decimal;
}

function toSummary(row: OrganisationCreditRow): CreditSummary {
  const available = row.creditLimit.minus(row.currentExposure);
  return {
    organisationId: row.id,
    legalName: row.legalName,
    tradeName: row.tradeName,
    status: row.status,
    creditLimit: row.creditLimit.toString(),
    currentExposure: row.currentExposure.toString(),
    availableCredit: available.isNegative() ? '0' : available.toString(),
  };
}
