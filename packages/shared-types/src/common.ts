/**
 * Shared transport shapes. These mirror the API conventions in docs/07 —
 * one success envelope, one error shape, everywhere.
 */

/** Collection response. `meta` carries pagination state. */
export interface Paginated<T> {
  readonly data: readonly T[];
  readonly meta: OffsetPageMeta | CursorPageMeta;
}

export interface OffsetPageMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface CursorPageMeta {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly hasNext: boolean;
}

/** Mutation response. */
export interface ApiResponse<T> {
  readonly data: T;
  readonly message?: string;
}

/**
 * RFC 9457 `application/problem+json`.
 * Clients have exactly one error parser because there is exactly one shape.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string;
  readonly correlationId?: string;
  readonly timestamp?: string;
  readonly errors?: readonly FieldError[];
}

export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
}

/** Stable machine-readable error codes. Never parse `detail` — parse these. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_NOT_VERIFIED: 'ACCOUNT_NOT_VERIFIED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_TOKEN_REUSE: 'REFRESH_TOKEN_REUSE',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  REQUEST_IN_PROGRESS: 'REQUEST_IN_PROGRESS',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  UPGRADE_REQUIRED: 'UPGRADE_REQUIRED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type SortDirection = 'asc' | 'desc';

/** Sort expression: `-placedAt` means descending. */
export type SortExpression = string;

/**
 * A value that survives a JSON round trip.
 *
 * Used wherever structured data crosses a boundary — audit metadata, webhook
 * payloads, configuration values. It exists so that "arbitrary JSON" is a
 * *checked* claim rather than `unknown` with a cast at the point of use.
 *
 * In particular it is structurally assignable to Prisma's `InputJsonValue`, so
 * an audit entry or a webhook body can be written to a `Json` column without a
 * cast — and a cast is precisely where an unserialisable value (a `Date`, a
 * class instance, `undefined`) would slip through and fail at write time.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface PageRequest {
  readonly page?: number;
  readonly pageSize?: number;
  readonly sort?: SortExpression;
}

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
  DEFAULT_CURSOR_LIMIT: 50,
  MAX_CURSOR_LIMIT: 100,
} as const;

/** Clamps a requested page size to the server-enforced maximum. */
export function clampPageSize(
  requested: number | undefined,
  fallback: number = PAGINATION.DEFAULT_PAGE_SIZE,
): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
  return Math.min(Math.floor(requested), PAGINATION.MAX_PAGE_SIZE);
}
