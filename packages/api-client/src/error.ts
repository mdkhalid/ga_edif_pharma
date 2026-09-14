import type { FieldError, ProblemDetails } from '@medichain/shared-types';

/**
 * The one error type every caller catches.
 *
 * The API answers failures with RFC 9457 problem details, but it answers with
 * `Content-Type: application/json` rather than `application/problem+json` (see
 * `all-exceptions.filter.ts`), so nothing may depend on the media type — the shape
 * is detected from the body instead.
 */

/**
 * Fallback status → code mapping, mirroring the backend's `STATUS_TO_CODE`.
 *
 * Only used when the problem body is missing or unparseable (a proxy 502, an HTML
 * error page). The authoritative code arrives in the problem document's `type`
 * URL, which is derived from the `ErrorCode` enum.
 */
const STATUS_TO_CODE: Readonly<Record<number, string>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_FAILED',
  422: 'BUSINESS_RULE_VIOLATION',
  426: 'UPGRADE_REQUIRED',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'DEPENDENCY_UNAVAILABLE',
};

function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'detail' in value &&
    typeof (value as { detail: unknown }).detail === 'string'
  );
}

/**
 * The `ErrorCode` carried by a problem document.
 *
 * The backend encodes the code in `type` (`…/problems/account-locked`), because
 * RFC 9457 reserves the other fields for human-readable text. Parsing it back out
 * is what lets a caller branch on `RATE_LIMITED` without string-matching `detail`,
 * which is a prose field that may be reworded at any time.
 */
function codeFromProblem(problem: ProblemDetails): string {
  const slug = problem.type?.split('/').pop();
  if (slug !== undefined && slug !== '') return slug.replace(/-/g, '_').toUpperCase();
  return STATUS_TO_CODE[problem.status] ?? 'INTERNAL_ERROR';
}

export class ApiError extends Error {
  readonly status: number;
  /** Stable machine-readable code — parse this, never `message`. */
  readonly code: string;
  /** The raw problem document, when the server sent one. */
  readonly problem?: ProblemDetails;
  /** Echoes the request's correlation id, for support and log correlation. */
  readonly correlationId?: string | null;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    problem?: ProblemDetails;
    correlationId?: string | null;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.problem = input.problem;
    this.correlationId = input.correlationId ?? input.problem?.correlationId ?? null;
  }

  /** Field-level validation failures, for mapping onto a form. */
  get fieldErrors(): readonly FieldError[] {
    return this.problem?.errors ?? [];
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** The account exists but has not verified its email or phone. */
  get requiresVerification(): boolean {
    return this.code === 'ACCOUNT_NOT_VERIFIED';
  }

  /**
   * The app version is below the server's minimum. The client must show a blocking
   * upgrade screen rather than retrying.
   */
  get requiresUpgrade(): boolean {
    return this.status === 426;
  }
}

/**
 * Builds an `ApiError` from a failed response.
 *
 * `parsed` is the body openapi-fetch already decoded, when it decoded one. The
 * response is only re-read as a fallback, and through a clone: the body may
 * already be disturbed, and reading it twice throws.
 */
export async function toApiError(response: Response, parsed?: unknown): Promise<ApiError> {
  let problem: ProblemDetails | undefined = isProblemDetails(parsed) ? parsed : undefined;

  if (problem === undefined) {
    try {
      const body: unknown = await response.clone().json();
      if (isProblemDetails(body)) problem = body;
    } catch {
      // Not JSON, or the body was already consumed. The status still tells us
      // enough to produce a usable error.
    }
  }

  const status = problem?.status ?? response.status;
  const code = problem === undefined ? (STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR') : codeFromProblem(problem);
  const message = problem?.detail ?? `Request failed with status ${status}.`;

  const correlationId =
    problem?.correlationId ?? response.headers.get('x-correlation-id') ?? null;

  return new ApiError({
    status,
    code,
    message,
    ...(problem === undefined ? {} : { problem }),
    correlationId,
  });
}
