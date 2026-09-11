import { PAGINATION } from '@medichain/shared-types';

import {
  buildCursorMeta,
  buildOffsetMeta,
  decodeCursor,
  encodeCursor,
  parseSortExpression,
  resolveOffset,
  trimCursorPage,
} from '../../src/common/utils/pagination.util';

describe('resolveOffset', () => {
  it('translates page/pageSize into skip/take', () => {
    expect(resolveOffset(3, 25)).toEqual({ page: 3, pageSize: 25, skip: 50, take: 25 });
  });

  it('defaults to the first page', () => {
    expect(resolveOffset(undefined, undefined)).toEqual({
      page: 1,
      pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
      skip: 0,
      take: PAGINATION.DEFAULT_PAGE_SIZE,
    });
  });

  it('clamps a page size above the maximum', () => {
    // A client asking for 10 000 rows must get the same 100 the API documents.
    const resolved = resolveOffset(1, 10_000);
    expect(resolved.pageSize).toBe(PAGINATION.MAX_PAGE_SIZE);
    expect(resolved.take).toBe(PAGINATION.MAX_PAGE_SIZE);
  });

  it('honours a custom fallback page size', () => {
    expect(resolveOffset(undefined, undefined, 10).pageSize).toBe(10);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('treats a %s page as page 1 rather than producing a negative skip', (_label, page) => {
    const resolved = resolveOffset(page, 25);
    expect(resolved.page).toBe(1);
    expect(resolved.skip).toBe(0);
  });

  it('floors a fractional page', () => {
    expect(resolveOffset(2.7, 25).page).toBe(2);
  });

  it('floors a fractional page size', () => {
    expect(resolveOffset(1, 25.9).pageSize).toBe(25);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
  ])('falls back when the page size is %s', (_label, size) => {
    expect(resolveOffset(1, size).pageSize).toBe(PAGINATION.DEFAULT_PAGE_SIZE);
  });
});

describe('buildOffsetMeta', () => {
  it('computes total pages and the navigation flags', () => {
    expect(buildOffsetMeta(250, { page: 2, pageSize: 25 })).toEqual({
      page: 2,
      pageSize: 25,
      total: 250,
      totalPages: 10,
      hasNext: true,
      hasPrev: true,
    });
  });

  it('reports no next page on the last page', () => {
    const meta = buildOffsetMeta(50, { page: 2, pageSize: 25 });
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrev).toBe(true);
  });

  it('reports no previous page on the first page', () => {
    const meta = buildOffsetMeta(50, { page: 1, pageSize: 25 });
    expect(meta.hasPrev).toBe(false);
    expect(meta.hasNext).toBe(true);
  });

  it('handles an empty result set', () => {
    expect(buildOffsetMeta(0, { page: 1, pageSize: 25 })).toEqual({
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('rounds a partial final page up', () => {
    expect(buildOffsetMeta(51, { page: 1, pageSize: 25 }).totalPages).toBe(3);
  });

  it('does not divide by zero when the page size is zero', () => {
    const meta = buildOffsetMeta(10, { page: 1, pageSize: 0 });
    expect(meta.totalPages).toBe(0);
    expect(Number.isFinite(meta.totalPages)).toBe(true);
  });
});

describe('buildCursorMeta', () => {
  it('reports another page when a cursor is present', () => {
    expect(buildCursorMeta(50, 'abc')).toEqual({ limit: 50, nextCursor: 'abc', hasNext: true });
  });

  it('reports the end of the list when the cursor is null', () => {
    expect(buildCursorMeta(50, null)).toEqual({ limit: 50, nextCursor: null, hasNext: false });
  });
});

describe('trimCursorPage', () => {
  const cursorOf = (row: { id: string }): string => row.id;

  it('returns everything when the page is not full', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(trimCursorPage(rows, 5, cursorOf)).toEqual({ data: rows, nextCursor: null });
  });

  it('drops the look-ahead row and returns its predecessor as the cursor', () => {
    // The caller fetches limit + 1 rows to learn whether another page exists
    // without a second COUNT(*).
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(trimCursorPage(rows, 2, cursorOf)).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'b',
    });
  });

  it('treats an exactly-full page as the last one', () => {
    // Exactly `limit` rows means there was no extra row, so there is no next page.
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(trimCursorPage(rows, 2, cursorOf).nextCursor).toBeNull();
  });

  it('handles an empty result set', () => {
    expect(trimCursorPage([], 10, cursorOf)).toEqual({ data: [], nextCursor: null });
  });
});

describe('parseSortExpression', () => {
  const allowed = ['placedAt', 'total', 'status'] as const;
  const fallback = [{ field: 'placedAt', direction: 'desc' }] as const;

  it('uses the fallback when no sort is given', () => {
    expect(parseSortExpression(undefined, allowed, fallback)).toEqual([
      { field: 'placedAt', direction: 'desc' },
    ]);
    expect(parseSortExpression('   ', allowed, fallback)).toEqual([
      { field: 'placedAt', direction: 'desc' },
    ]);
  });

  it('defaults to ascending', () => {
    expect(parseSortExpression('total', allowed, fallback)).toEqual([
      { field: 'total', direction: 'asc' },
    ]);
  });

  it('reads a leading minus as descending', () => {
    expect(parseSortExpression('-total', allowed, fallback)).toEqual([
      { field: 'total', direction: 'desc' },
    ]);
  });

  it('parses a multi-field expression', () => {
    expect(parseSortExpression('status,-placedAt', allowed, fallback)).toEqual([
      { field: 'status', direction: 'asc' },
      { field: 'placedAt', direction: 'desc' },
    ]);
  });

  it('rejects a field outside the allow-list', () => {
    // Prisma will order by any column it is given, so an unvalidated
    // `?sort=passwordHash` becomes a field-probing oracle.
    expect(parseSortExpression('passwordHash', allowed, fallback)).toEqual([
      { field: 'placedAt', direction: 'desc' },
    ]);
  });

  it('keeps the known fields from a mixed expression', () => {
    expect(parseSortExpression('passwordHash,-total', allowed, fallback)).toEqual([
      { field: 'total', direction: 'desc' },
    ]);
  });

  it('ignores a repeated field rather than emitting a duplicate orderBy', () => {
    expect(parseSortExpression('total,-total', allowed, fallback)).toEqual([
      { field: 'total', direction: 'asc' },
    ]);
  });

  it('ignores empty tokens', () => {
    expect(parseSortExpression('total,,status', allowed, fallback)).toEqual([
      { field: 'total', direction: 'asc' },
      { field: 'status', direction: 'asc' },
    ]);
  });

  it('falls back rather than returning an unordered result', () => {
    // An empty orderBy makes Postgres free to return rows in any order between
    // pages, which silently duplicates and drops rows.
    expect(parseSortExpression('nope,alsonope', allowed, fallback)).toHaveLength(1);
  });

  it('does not mutate the caller’s fallback array', () => {
    const fallbackArray = [{ field: 'placedAt' as const, direction: 'desc' as const }];
    const result = parseSortExpression('total', allowed, fallbackArray);
    expect(fallbackArray).toHaveLength(1);
    expect(result).not.toBe(fallbackArray);
  });

  it('handles a bare minus with no field name', () => {
    expect(parseSortExpression('-', allowed, fallback)).toEqual([
      { field: 'placedAt', direction: 'desc' },
    ]);
  });
});

describe('cursor encoding', () => {
  it('round-trips a payload', () => {
    const payload = { placedAt: '2026-09-11T00:00:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('produces a URL-safe token', () => {
    expect(encodeCursor({ id: 'a/b+c=' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is opaque, not encrypted — it hides the shape rather than the value', () => {
    const token = encodeCursor({ id: 'visible-if-decoded' });
    expect(token).not.toContain('visible-if-decoded');
    expect(Buffer.from(token, 'base64url').toString('utf8')).toContain('visible-if-decoded');
  });

  it('returns null for a malformed token instead of throwing', () => {
    expect(decodeCursor('not-valid-base64-json!!')).toBeNull();
  });

  it('returns null when the payload is not an object', () => {
    const scalar = Buffer.from(JSON.stringify('a string'), 'utf8').toString('base64url');
    const array = Buffer.from(JSON.stringify([1, 2]), 'utf8').toString('base64url');
    const nil = Buffer.from('null', 'utf8').toString('base64url');

    expect(decodeCursor(scalar)).toBeNull();
    expect(decodeCursor(array)).toBeNull();
    expect(decodeCursor(nil)).toBeNull();
  });
});
