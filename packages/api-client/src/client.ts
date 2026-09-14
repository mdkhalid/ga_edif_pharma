import createClient, { type Client } from 'openapi-fetch';

import { toApiError } from './error';
import type { paths } from './generated/schema';

/**
 * The typed HTTP client.
 *
 * ## Why the base URL includes `/api/v1`
 *
 * The backend mounts every route under a global prefix, but Swagger does not apply
 * `setGlobalPrefix`, so the committed `openapi.json` has no prefix and an empty
 * `servers` array. Rather than rewrite the spec on its way to the generator, the
 * prefix is supplied once, here, as part of `baseUrl`. That keeps the committed
 * OpenAPI document an honest description of the controllers, and keeps the
 * client's base URL in exactly one place.
 *
 * Callers pass the full prefix: `http://localhost:3001/api/v1`. The three
 * unprefixed routes (`/health/*`, `/metrics`) are probes, not part of the client's
 * surface.
 */

export type MediChainClient = Client<paths>;

export interface ApiClientOptions {
  /** Absolute base URL, including the API prefix — e.g. `…:3001/api/v1`. */
  readonly baseUrl: string;
  /**
   * Called on every request. Return the in-memory access token, or `null`.
   *
   * A function rather than a value: the token rotates silently on refresh, and a
   * captured string would keep sending the expired one.
   */
  readonly getAccessToken?: () => string | null;
  /** Sent as `X-App-Version`; the server uses it for the force-upgrade check. */
  readonly appVersion?: string;
  /** Sent as `X-App-Platform`: `web`, `admin` or `mobile`. */
  readonly appPlatform?: string;
  /** Injectable for tests and for runtimes with a non-global fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createApiClient(options: ApiClientOptions): MediChainClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  // Every request carries the access token and the client's build identity. The
  // refresh token is deliberately NOT here: on the web it lives in an HttpOnly
  // cookie managed by the BFF route, and on mobile in the Keychain — neither is
  // readable here, and neither should be.
  client.use({
    onRequest({ request }) {
      const token = options.getAccessToken?.();
      if (token !== undefined && token !== null && token !== '') {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      if (options.appVersion !== undefined) {
        request.headers.set('X-App-Version', options.appVersion);
      }
      if (options.appPlatform !== undefined) {
        request.headers.set('X-App-Platform', options.appPlatform);
      }
      return request;
    },
  });

  return client;
}

/**
 * Unwraps a `{ data: T }` success envelope, or throws a typed `ApiError`.
 *
 * The success envelope is authored by each controller (`return { data: result }`)
 * rather than by the response interceptor, so it is not described in the spec and
 * the generated response types are `unknown`. The response type therefore comes
 * from `@medichain/shared-types`, which is the same definition the backend
 * compiles against — a hand-written interface here would be a fourth copy that
 * drifts.
 */
export async function unwrap<T>(result: {
  data?: unknown;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.response.ok) {
    const body = result.data;
    if (typeof body === 'object' && body !== null && 'data' in body) {
      return (body as { data: T }).data;
    }
    // A 204 or a body-less success: nothing to unwrap.
    return undefined as T;
  }
  throw await toApiError(result.response, result.error);
}

/** Unwraps a `void` success (204) or throws. */
export async function unwrapVoid(result: {
  data?: unknown;
  error?: unknown;
  response: Response;
}): Promise<void> {
  if (result.response.ok) return;
  throw await toApiError(result.response, result.error);
}
