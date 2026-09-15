import { Inject, Injectable } from '@nestjs/common';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import {
  buildOffsetMeta,
  resolveOffset,
} from '../../../common/utils/pagination.util';
import { canonicalCompositionKey, parseSaltQuery } from '../domain/composition-key';

/**
 * Salt engine: exact and combination search over product compositions.
 *
 * A product matches a token when the token appears (case-insensitive,
 * substring) in its name, any salt alias, or any composition name. A
 * combination query matches only products matching **every** token (AND).
 * An exact match additionally requires the product's `compositionKey` to
 * equal the canonical key of the query.
 *
 * Candidates are fetched with a single OR query and narrowed in memory.
 * That is a deliberate MVP trade-off: it is correct at catalogue scale and
 * needs no `pg_trgm`/FTS migration. When the catalogue outgrows it, the
 * narrowing moves into a `pg_trgm` similarity query behind this same
 * service — callers do not change. True typo tolerance (`Paracetmol` →
 * Paracetamol) arrives with that migration and is not claimed here.
 */
@Injectable()
export class SaltEngineService {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async search(
    rawQuery: string,
    options: { schedule?: string; page?: number; pageSize?: number } = {},
  ): Promise<{
    data: Array<{
      id: string;
      name: string;
      schedule: string;
      price: string;
      exact: boolean;
    }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    const tokens = parseSaltQuery(rawQuery);
    const resolved = resolveOffset(options.page, options.pageSize);

    if (tokens.length === 0) {
      return { data: [], meta: buildOffsetMeta(0, resolved) };
    }

    const key = canonicalCompositionKey(tokens);

    // Candidate fetch is intentionally coarse: Prisma cannot query text[]
    // columns case-insensitively (only exact `has`, which misses on casing),
    // so the fetch is a schedule-filtered superset and the in-memory filter
    // below — over name, aliases and composition names — is authoritative.
    // Capped at 500 rows: correct at MVP catalogue scale; the `pg_trgm`
    // migration moves matching into the database when that cap binds.
    const candidates = await this.prisma.product.findMany({
      where: {
        ...(options.schedule ? { schedule: options.schedule } : {}),
      },
      select: {
        id: true,
        name: true,
        schedule: true,
        price: true,
        saltAliases: true,
        compositionNames: true,
        compositionKey: true,
      },
      take: 500,
    });

    const haystackOf = (row: {
      name: string;
      saltAliases: string[];
      compositionNames: string[];
    }): string =>
      [row.name, ...row.saltAliases, ...row.compositionNames].join(' ').toLowerCase();

    const matched = candidates.filter((row) => {
      const haystack = haystackOf(row);
      return tokens.every((token) => haystack.includes(token));
    });

    const total = matched.length;
    const page = matched.slice(resolved.skip, resolved.skip + resolved.take);

    return {
      data: page.map((row) => ({
        id: row.id,
        name: row.name,
        schedule: row.schedule,
        price: row.price.toString(),
        exact: row.compositionKey !== null && row.compositionKey === key,
      })),
      meta: buildOffsetMeta(total, resolved),
    };
  }
}
