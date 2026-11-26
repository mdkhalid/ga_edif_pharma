/**
 * Contract tests for the typed client's cross-cutting behaviour.
 *
 * Every endpoint factory funnels success through `unwrap`/`unwrapPage`/
 * `unwrapVoid` and failure through `toApiError`. A defect here is invisible to
 * typechecking and to the backend's own suites: the money path can be correct
 * while the screen receives an array where it expected `{ data, meta }`.
 */
import { ApiError, toApiError, unwrap, unwrapPage, unwrapVoid } from '../src';

import {
  createHarness,
  emptyResponse,
  jsonResponse,
  pageBody,
  problemResponse,
} from './support/fetch';

const notFound = problemResponse({
  type: 'https://errors.medichain.test/problems/not_found',
  title: 'Not found',
  status: 404,
  detail: 'No such product.',
  correlationId: 'corr-client-1',
  errors: [{ field: 'id', code: 'NOT_FOUND', message: 'Unknown id.' }],
});

async function failed<T>(work: Promise<T>): Promise<unknown> {
  return work.catch((error: unknown) => error);
}

describe('createApiClient', () => {
  it('sends the current token, version and platform on every request', async () => {
    let token: string | null = 'token-first';
    const harness = createHarness(undefined, {
      getAccessToken: () => token,
      appVersion: '1.2.3',
      appPlatform: 'web',
    });

    await harness.client.GET('/catalog/products');
    token = 'token-second'; // silent refresh rotates the token between calls
    await harness.client.GET('/catalog/products');

    expect(harness.requests.map((r) => r.headers.get('authorization'))).toEqual([
      'Bearer token-first',
      'Bearer token-second',
    ]);
    for (const request of harness.requests) {
      expect(request.headers.get('x-app-version')).toBe('1.2.3');
      expect(request.headers.get('x-app-platform')).toBe('web');
    }
  });

  it('omits identity headers when they are not configured', async () => {
    const harness = createHarness();
    await harness.client.GET('/catalog/products');

    expect(harness.requests[0]?.headers.has('authorization')).toBe(false);
    expect(harness.requests[0]?.headers.has('x-app-version')).toBe(false);
    expect(harness.requests[0]?.headers.has('x-app-platform')).toBe(false);
  });
});

describe('unwrap', () => {
  it('returns the inner value of a single-resource envelope', async () => {
    const value = await unwrap<{ id: string }>({
      data: { data: { id: 'p-1' } },
      response: jsonResponse({ data: { id: 'p-1' } }),
    });

    expect(value).toEqual({ id: 'p-1' });
  });

  it('returns undefined for a body-less success', async () => {
    await expect(unwrap({ response: emptyResponse() })).resolves.toBeUndefined();
  });

  it('turns problem details into the one ApiError every caller catches', async () => {
    const problem = (await notFound.clone().json()) as unknown;
    const error = await failed(unwrap({ error: problem, response: notFound.clone() }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'No such product.',
      correlationId: 'corr-client-1',
    });
    expect((error as ApiError).fieldErrors).toEqual([
      { field: 'id', code: 'NOT_FOUND', message: 'Unknown id.' },
    ]);
    expect((error as ApiError).isUnauthenticated).toBe(false);
  });

  it('falls back to the status mapping when the body is not a problem document', async () => {
    const response = new Response('<html>bad gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
    const error = await failed(unwrap({ error: '<html>bad gateway</html>', response }));

    expect(error).toMatchObject({
      status: 502,
      code: 'INTERNAL_ERROR',
      message: 'Request failed with status 502.',
      correlationId: null,
    });
  });
});

describe('unwrapPage', () => {
  it('keeps both the rows and the meta of a paginated response', async () => {
    const body = pageBody();
    const page = await unwrapPage<typeof body>({
      data: body,
      response: jsonResponse(body),
    });

    // The original defect: unwrap() returned the bare `data` array and dropped
    // `meta`, so `result.meta.total` crashed on every paged screen.
    expect(page.data).toEqual([{ id: 'row-1' }]);
    expect(page.meta).toEqual({
      page: 2,
      pageSize: 1,
      total: 3,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    });
  });

  it.each([
    ['missing meta', { data: [{ id: 'row-1' }] }],
    ['rows not an array', { data: { id: 'row-1' }, meta: { total: 1 } }],
    ['meta not an object', { data: [{ id: 'row-1' }], meta: null }],
  ])('fails loudly on a contract break: %s', async (_label, body) => {
    const error = await failed(
      unwrapPage({ data: body, response: jsonResponse(body) }),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Malformed paginated response');
  });

  it('maps a failed page to ApiError like any other endpoint', async () => {
    const problem = (await notFound.clone().json()) as unknown;
    const error = await failed(unwrapPage({ error: problem, response: notFound.clone() }));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_FOUND');
  });
});

describe('unwrapVoid', () => {
  it('resolves on 204', async () => {
    await expect(unwrapVoid({ response: emptyResponse() })).resolves.toBeUndefined();
  });

  it('throws on failure rather than treating it as a successful mutation', async () => {
    const error = await failed(unwrapVoid({ response: notFound.clone() }));
    expect(error).toBeInstanceOf(ApiError);
  });
});

describe('toApiError', () => {
  it('reads the machine code from the problem type, never from prose', async () => {
    const response = problemResponse({
      type: 'https://errors.medichain.test/problems/account_locked',
      title: 'Account locked',
      status: 423,
      detail: 'Too many attempts.',
    });

    const error = await toApiError(response);
    expect(error.code).toBe('ACCOUNT_LOCKED');
    expect(error.message).toBe('Too many attempts.');
  });

  it('exposes the flags the three clients branch on', async () => {
    const unauthenticated = await toApiError(
      problemResponse({
        type: 'https://errors.medichain.test/problems/unauthenticated',
        title: 'Unauthenticated',
        status: 401,
        detail: 'Sign in again.',
      }),
    );
    const upgrade = await toApiError(
      new Response('too old', { status: 426, headers: { 'content-type': 'text/plain' } }),
    );

    expect(unauthenticated.isUnauthenticated).toBe(true);
    expect(unauthenticated.requiresVerification).toBe(false);
    expect(upgrade.requiresUpgrade).toBe(true);
  });
});
