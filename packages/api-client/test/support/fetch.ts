/**
 * Fetch harness for the API client's contract tests.
 *
 * The client accepts an injected `fetch` (`ApiClientOptions.fetch`), so these
 * tests exercise the real `openapi-fetch` request/response pipeline — path and
 * query serialisation, middleware headers, body parsing — with no live API.
 * What they assert is the wire contract, not a stub of `unwrap()`.
 */
import type { FieldError } from '@medichain/shared-types';

import { createApiClient, type ApiClientOptions, type MediChainClient } from '../../src/client';

export const BASE_URL = 'https://api.test/api/v1';

export interface RecordedRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: string;
}

export type RequestHandler = (request: RecordedRequest) => Response | Promise<Response>;

export interface ClientHarness {
  readonly client: MediChainClient;
  readonly requests: readonly RecordedRequest[];
}

/** A JSON success response. The body is the controller's envelope, not spec-generated. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A 204 has no body — constructing a Response with one would throw. */
export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

/** RFC 9457 problem details: the one failure shape every caller catches. */
export function problemResponse(input: {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly correlationId?: string;
  readonly errors?: readonly FieldError[];
}): Response {
  return jsonResponse(
    {
      type: input.type,
      title: input.title,
      status: input.status,
      detail: input.detail,
      correlationId: input.correlationId,
      ...(input.errors === undefined ? {} : { errors: input.errors }),
    },
    input.status,
  );
}

/** A page as the controllers author it: `{ data: rows, meta }`. */
export const PAGE_META = {
  page: 2,
  pageSize: 1,
  total: 3,
  totalPages: 3,
  hasNext: true,
  hasPrev: true,
} as const;

export function pageBody(rows: readonly unknown[] = [{ id: 'row-1' }]): {
  readonly data: readonly unknown[];
  readonly meta: typeof PAGE_META;
} {
  return { data: rows, meta: PAGE_META };
}

/**
 * Builds a client plus a log of every request it made. The default handler
 * returns an empty success envelope, so a test only has to supply a response
 * when the shape under test matters.
 */
export function createHarness(
  handler: RequestHandler = () => jsonResponse({ data: null }),
  options: Partial<ApiClientOptions> = {},
): ClientHarness {
  const requests: RecordedRequest[] = [];

  const fetchMock: typeof globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    // Clone before reading: the handler may need the original body later.
    const body = await request.clone().text();
    requests.push({
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body,
    });
    return handler({
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body,
    });
  };

  return {
    client: createApiClient({ baseUrl: BASE_URL, fetch: fetchMock, ...options }),
    requests,
  };
}
