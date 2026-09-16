'use client';

import { createSearchApi } from '@medichain/api-client';
import type { SaltSearchPage, ScheduleClass } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

/**
 * Salt-combination search.
 *
 * The query is passed through untouched. The server parses `+`, `,`, `&`, `and`
 * and friends with the shared normaliser in `@medichain/shared-utils`, which is
 * also what built every product's `composition_key` — so a client that rewrote the
 * string would be second-guessing the rule that decides whether a match is exact.
 */

export const SALT_PAGE_SIZE = 20;

export interface SaltQuery {
  readonly q: string;
  readonly page: number;
  readonly pageSize: number;
  readonly schedule?: ScheduleClass;
}

export function searchBySalt(query: SaltQuery): Promise<SaltSearchPage> {
  return callAuthed((client) => createSearchApi(client).products(query));
}
