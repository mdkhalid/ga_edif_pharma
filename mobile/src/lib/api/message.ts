import { ApiError } from '@medichain/api-client';

/**
 * The one user-facing error message helper for API failures.
 *
 * `ApiError.message` is the server's problem detail — the stable machine code
 * stays on `error.code` for branching, but prose is what a buyer can act on.
 * Everything else is a network or coding failure, for which a generic message
 * is safer than leaking an exception's internals into the UI.
 */
export function apiErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}
