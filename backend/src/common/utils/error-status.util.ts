/**
 * Resolves the HTTP status of a thrown value.
 *
 * Shared by the logging and metrics interceptors so both label a failed request
 * with the same status. Deriving it in two places is how a dashboard and a log
 * line end up disagreeing about the same request.
 */
export function statusOfError(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    if ('getStatus' in error) {
      const candidate = error as { getStatus?: () => number };
      if (typeof candidate.getStatus === 'function') return candidate.getStatus();
    }
    if ('httpStatus' in error) {
      const status = (error as { httpStatus?: unknown }).httpStatus;
      if (typeof status === 'number') return status;
    }
  }
  return 500;
}
