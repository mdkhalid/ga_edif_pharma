import type { CursorPageMeta, OffsetPageMeta } from '@medichain/shared-types';
import { PAGINATION, clampPageSize } from '@medichain/shared-types';

/**
 * Pagination helpers.
 *
 * Two strategies coexist because they solve different problems:
 *
 *   - **Offset** for back-office tables, where the user jumps to page 7 and a
 *     stable total count matters.
 *   - **Cursor** for infinite-scrolling feeds and for any list that changes
 *     while it is being read. `OFFSET 10000` also forces Postgres to walk and
 *     discard 10 000 rows, so deep offset pagination degrades as the data grows.
 *
 * The backend never invents its own page-size ceiling: `clampPageSize` comes
 * from `@medichain/shared-types`, so a client that asks for 10 000 rows gets the
 * same 100 the API documents.
 */

export interface ResolvedOffset {
  readonly page: number;
  readonly pageSize: number;
  readonly skip: number;
  readonly take: number;
}

/** Normalises page/pageSize into Prisma's `skip`/`take`, clamped to the maximum. */
export function resolveOffset(
  page: number | undefined,
  pageSize: number | undefined,
  fallbackPageSize: number = PAGINATION.DEFAULT_PAGE_SIZE,
): ResolvedOffset {
  const safePage = page === undefined || !Number.isFinite(page) || page < 1 ? 1 : Math.floor(page);
  const safeSize = clampPageSize(pageSize, fallbackPageSize);

  return {
    page: safePage,
    pageSize: safeSize,
    skip: (safePage - 1) * safeSize,
    take: safeSize,
  };
}

/** Builds the `meta` block for an offset-paginated collection. */
export function buildOffsetMeta(
  total: number,
  resolved: Pick<ResolvedOffset, 'page' | 'pageSize'>,
): OffsetPageMeta {
  const totalPages = resolved.pageSize === 0 ? 0 : Math.ceil(total / resolved.pageSize);
  return {
    page: resolved.page,
    pageSize: resolved.pageSize,
    total,
    totalPages,
    hasNext: resolved.page < totalPages,
    hasPrev: resolved.page > 1,
  };
}

/** Builds the `meta` block for a cursor-paginated collection. */
export function buildCursorMeta(limit: number, nextCursor: string | null): CursorPageMeta {
  return { limit, nextCursor, hasNext: nextCursor !== null };
}

/**
 * Fetches `limit + 1` rows to discover whether another page exists, then trims.
 *
 * The extra row avoids a second `COUNT(*)` on every page, which on a large
 * orders table is more expensive than the row itself.
 */
export function trimCursorPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => string,
): { data: readonly T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { data: rows, nextCursor: null };
  }
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: page,
    nextCursor: last === undefined ? null : cursorOf(last),
  };
}

/**
 * Parses a sort expression into Prisma `orderBy`, allowing only known fields.
 *
 * The allow-list is not optional. Prisma will happily order by any column name
 * it is given, so an unvalidated `?sort=passwordHash` lets a caller probe for
 * the existence of fields and, on a nullable column, infer values from ordering.
 * An unknown field is dropped rather than throwing: a stale client asking for a
 * removed column should still get its data.
 *
 * `-placedAt` means descending; `placedAt` means ascending.
 */
export function parseSortExpression<TField extends string>(
  sort: string | undefined,
  allowed: readonly TField[],
  fallback: ReadonlyArray<{ field: TField; direction: 'asc' | 'desc' }>,
): Array<{ field: TField; direction: 'asc' | 'desc' }> {
  if (sort === undefined || sort.trim() === '') return [...fallback];

  const parsed: Array<{ field: TField; direction: 'asc' | 'desc' }> = [];

  for (const token of sort.split(',')) {
    const trimmed = token.trim();
    if (trimmed === '') continue;

    const descending = trimmed.startsWith('-');
    const field = (descending ? trimmed.slice(1) : trimmed) as TField;

    if (!allowed.includes(field)) continue;
    if (parsed.some((entry) => entry.field === field)) continue;

    parsed.push({ field, direction: descending ? 'desc' : 'asc' });
  }

  // An expression of only unknown fields falls back rather than returning
  // Postgres an unordered result, which is non-deterministic between pages.
  return parsed.length > 0 ? parsed : [...fallback];
}

/**
 * Encodes a cursor as an opaque base64url token.
 *
 * Opaque so clients cannot construct one and so the underlying keyset columns
 * can change without a breaking API change. The payload is not secret — it is
 * not encrypted — it is only hidden to discourage depending on its shape.
 */
export function encodeCursor(payload: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Decodes a cursor. Returns `null` for a malformed token rather than throwing. */
export function decodeCursor<T extends Record<string, unknown>>(cursor: string): T | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
