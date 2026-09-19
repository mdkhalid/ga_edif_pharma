import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import {
  buildOffsetMeta,
  resolveOffset,
} from '../../../common/utils/pagination.util';
import { canonicalCompositionKey, parseSaltQuery } from '../domain/composition-key';

/** One candidate row, normalised across both search passes. */
interface Candidate {
  id: string;
  name: string;
  schedule: string;
  price: Prisma.Decimal;
  compositionKey: string | null;
}

/** Shape returned by the trigram query. Raw SQL yields column names verbatim. */
interface TrigramRow {
  id: string;
  name: string;
  schedule: string;
  price: Prisma.Decimal;
  composition_key: string | null;
}

/**
 * A query with more tokens than this is not a salt combination, it is a
 * pasted sentence or a stray newline. The exact pass still handles it; the
 * trigram pass declines rather than building an unbounded `WHERE`.
 */
const MAX_TRIGRAM_TOKENS = 8;

/**
 * Word-similarity floor for the typo pass, overriding pg_trgm's default of
 * 0.6. That default is too tight to be useful here: the commonest realistic
 * typo, `parasetamol` (t for s), scores exactly 0.600 and a strict `>`
 * comparison rejects it. Measured against the catalogue, real typos score
 * 0.60-0.90 while unrelated salts score below 0.30, so 0.45 sits in the gap
 * with margin on both sides.
 */
const WORD_SIMILARITY_THRESHOLD = 0.45;

/** Rows the trigram pass will consider before paging in memory. */
const TRIGRAM_CANDIDATE_LIMIT = 100;

/**
 * Salt engine: exact and combination search over product compositions.
 *
 * A product matches a token when the token appears (case-insensitive,
 * substring) in its name, any salt alias, or any composition name. A
 * combination query matches only products matching **every** token (AND).
 * An exact match additionally requires the product's `compositionKey` to
 * equal the canonical key of the query.
 *
 * ## Two passes
 *
 * The first pass is the original one: fetch a schedule-filtered superset and
 * narrow in memory by substring. Prisma cannot query `text[]` columns
 * case-insensitively, so the in-memory filter is authoritative for it.
 *
 * The second pass is the typo tolerance (`Paracetmol` → Paracetamol). It runs
 * **only when the first pass matches nothing** — a query that already has a
 * correct answer should never be broadened, and fuzzy results are strictly
 * worse than exact ones. It runs in the database against `pg_trgm` indexes, so
 * it is not subject to the 500-row cap the first pass carries, and it matches
 * the same three sources, so a typo is tolerated wherever the correct spelling
 * would have matched (including products that name the salt only in their
 * composition, such as `Dolo 650mg`).
 */
@Injectable()
export class SaltEngineService {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async search(
    tenantId: string,
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

    // Pass 1 is intentionally coarse: Prisma cannot query text[] columns
    // case-insensitively (only exact `has`, which misses on casing), so the
    // fetch is a schedule-filtered superset and the in-memory filter below —
    // over name, aliases and composition names — is authoritative.
    // Capped at 500 rows: correct at MVP catalogue scale, and the trigram pass
    // below covers queries this cap would otherwise hide.
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

    const exactMatches: Candidate[] = candidates
      .filter((row) => {
        const haystack = haystackOf(row);
        return tokens.every((token) => haystack.includes(token));
      })
      .map((row) => ({
        id: row.id,
        name: row.name,
        schedule: row.schedule,
        price: row.price,
        compositionKey: row.compositionKey,
      }));

    const matched =
      exactMatches.length > 0
        ? exactMatches
        : await this.trigramMatches(tenantId, tokens, options.schedule);

    const page = matched.slice(resolved.skip, resolved.skip + resolved.take);

    return {
      data: page.map((row) => ({
        id: row.id,
        name: row.name,
        schedule: row.schedule,
        price: row.price.toString(),
        exact: row.compositionKey !== null && row.compositionKey === key,
      })),
      meta: buildOffsetMeta(matched.length, resolved),
    };
  }

  /**
   * Typo-tolerant matching via `pg_trgm`, requiring every token to fuzzy-match
   * at least one of the three sources.
   *
   * Raw SQL bypasses the tenant-scoping extension by design, so the tenant
   * filter is written out explicitly — this is the one place the automatic
   * protection does not reach, and it is why the query takes `tenantId` rather
   * than reading it from the ambient context.
   *
   * The threshold is applied with `SET LOCAL` inside a transaction because it
   * is a session setting: setting it outside a transaction would leak into
   * whichever request next uses this pooled connection.
   */
  private async trigramMatches(
    tenantId: string,
    tokens: readonly string[],
    schedule: string | undefined,
  ): Promise<Candidate[]> {
    if (tokens.length > MAX_TRIGRAM_TOKENS) return [];

    const params: unknown[] = [tenantId];
    const conditions: string[] = [];

    if (schedule !== undefined) {
      params.push(schedule);
      conditions.push(`p."schedule" = $${params.length}`);
    }

    let firstTokenPlaceholder = '';
    for (const token of tokens) {
      params.push(token);
      const placeholder = `$${params.length}`;
      if (firstTokenPlaceholder === '') firstTokenPlaceholder = placeholder;
      conditions.push(
        `(${placeholder} <% p."name"` +
          ` OR ${placeholder} <% medichain_text_array_to_string(p."salt_aliases")` +
          ` OR ${placeholder} <% medichain_text_array_to_string(p."composition_names"))`,
      );
    }

    // The threshold and the limit are numeric constants declared in this file —
    // never user input — so interpolating them is safe. Tokens and the schedule
    // are bound parameters.
    const sql =
      `SELECT p."id", p."name", p."schedule", p."price", p."composition_key"` +
      ` FROM "product" p` +
      ` WHERE p."tenant_id" = $1::uuid AND ${conditions.join(' AND ')}` +
      ` ORDER BY GREATEST(` +
      `word_similarity(${firstTokenPlaceholder}, p."name"),` +
      `word_similarity(${firstTokenPlaceholder}, medichain_text_array_to_string(p."salt_aliases")),` +
      `word_similarity(${firstTokenPlaceholder}, medichain_text_array_to_string(p."composition_names"))` +
      `) DESC` +
      ` LIMIT ${TRIGRAM_CANDIDATE_LIMIT}`;

    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL pg_trgm.word_similarity_threshold = ${WORD_SIMILARITY_THRESHOLD}`,
      );
      return tx.$queryRawUnsafe<TrigramRow[]>(sql, ...params);
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      schedule: row.schedule,
      price: row.price,
      compositionKey: row.composition_key,
    }));
  }
}
