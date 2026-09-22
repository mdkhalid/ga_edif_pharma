import { ErrorCode } from '@medichain/shared-types';

/**
 * Base class for every error the application raises deliberately.
 *
 * Carrying the HTTP status and the machine-readable code on the error itself
 * means the exception filter is a pure mapping function with no `instanceof`
 * ladder to maintain, and adding a new error type never requires touching it.
 */
export class DomainException extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly httpStatus: number,
    readonly meta?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

// ------------------------------------------------------------------ 400/422

export class ValidationFailedError extends DomainException {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, ErrorCode.VALIDATION_FAILED, 400, meta);
  }
}

/** Syntactically valid, semantically rejected — e.g. a credit limit breach. */
export class BusinessRuleViolationError extends DomainException {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, ErrorCode.BUSINESS_RULE_VIOLATION, 422, meta);
  }
}

// -------------------------------------------------------------------- auth

export class UnauthenticatedError extends DomainException {
  constructor(message = 'Authentication required.') {
    super(message, ErrorCode.UNAUTHENTICATED, 401);
  }
}

export class InvalidCredentialsError extends DomainException {
  constructor() {
    // Deliberately vague: distinguishing "unknown email" from "wrong password"
    // tells an attacker which accounts exist.
    super('Email or password is incorrect.', ErrorCode.INVALID_CREDENTIALS, 401);
  }
}

export class AccountLockedError extends DomainException {
  constructor(readonly lockedUntil: Date) {
    super(
      'Account temporarily locked after too many failed attempts.',
      ErrorCode.ACCOUNT_LOCKED,
      423,
      { lockedUntil: lockedUntil.toISOString() },
    );
  }
}

export class AccountNotVerifiedError extends DomainException {
  constructor() {
    super('Account is not verified.', ErrorCode.ACCOUNT_NOT_VERIFIED, 403);
  }
}

/**
 * A one-time code that does not match any outstanding challenge.
 *
 * Deliberately a single error for "no code was requested", "the code is wrong"
 * and "the code was already used": distinguishing them would tell a caller which
 * identifiers have a live challenge, and a code that has been consumed is not
 * meaningfully different from one that never existed.
 */
export class OtpInvalidError extends DomainException {
  constructor(message = 'That code is not valid. Request a new one and try again.') {
    super(message, ErrorCode.OTP_INVALID, 400);
  }
}

export class OtpExpiredError extends DomainException {
  constructor() {
    super('That code has expired. Request a new one and try again.', ErrorCode.OTP_EXPIRED, 400);
  }
}

/**
 * The attempt cap for a challenge has been reached.
 *
 * 429 rather than 400: the caller must stop trying and request a fresh code. The
 * cap is what makes a six-digit code safe — without it, a million guesses fit
 * comfortably inside a ten-minute window.
 */
export class OtpAttemptsExceededError extends DomainException {
  constructor() {
    super(
      'Too many incorrect attempts for this code. Request a new one.',
      ErrorCode.OTP_ATTEMPTS_EXCEEDED,
      429,
    );
  }
}

export class TokenExpiredError extends DomainException {
  constructor() {
    super('Token has expired.', ErrorCode.TOKEN_EXPIRED, 401);
  }
}

/**
 * A TOTP code or recovery code that does not match.
 *
 * One error for "wrong code", "no enrolment in progress" at the code check, and
 * "secret missing": distinguishing them tells an attacker which accounts have
 * MFA and how far along an enrolment is. The enrolment-not-started case is a
 * `ConflictError` instead — it is a client sequencing bug, not a guess.
 */
export class MfaCodeInvalidError extends DomainException {
  constructor(message = 'That code is not valid. Check your authenticator app and try again.') {
    super(message, ErrorCode.MFA_CODE_INVALID, 400);
  }
}

/**
 * The MFA challenge token is missing, expired, or was not an MFA challenge.
 *
 * Deliberately one error: a caller cannot learn whether a token was ever valid.
 */
export class MfaChallengeInvalidError extends DomainException {
  constructor(message = 'This sign-in attempt has expired. Sign in again.') {
    super(message, ErrorCode.MFA_CHALLENGE_INVALID, 401);
  }
}

export class TokenInvalidError extends DomainException {
  constructor(message = 'Token is invalid.') {
    super(message, ErrorCode.TOKEN_INVALID, 401);
  }
}

/**
 * A refresh token that had already been rotated was presented again.
 * The token was stolen and replayed — the entire token family is revoked.
 */
export class RefreshTokenReuseError extends DomainException {
  constructor() {
    super(
      'This refresh token was already used. All sessions have been revoked as a precaution.',
      ErrorCode.REFRESH_TOKEN_REUSE,
      401,
    );
  }
}

// ------------------------------------------------------------------- 403/404

export class ForbiddenError extends DomainException {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, ErrorCode.FORBIDDEN, 403);
  }
}

/**
 * Also used when a resource exists but belongs to another tenant.
 *
 * Returning 403 there would confirm the resource exists, which is an
 * information leak. Cross-tenant access is indistinguishable from not found.
 */
export class NotFoundError extends DomainException {
  constructor(resource = 'Resource', id?: string) {
    super(
      id === undefined ? `${resource} not found.` : `${resource} not found.`,
      ErrorCode.NOT_FOUND,
      404,
      id === undefined ? undefined : { resource, id },
    );
  }
}

// ---------------------------------------------------------------------- 409

export class ConflictError extends DomainException {
  constructor(message: string, code: ErrorCode = ErrorCode.CONFLICT, meta?: Record<string, unknown>) {
    super(message, code, 409, meta);
  }
}

export class EmailAlreadyRegisteredError extends DomainException {
  constructor() {
    super('An account with this email already exists.', ErrorCode.EMAIL_ALREADY_REGISTERED, 409);
  }
}

export class PhoneAlreadyRegisteredError extends DomainException {
  constructor() {
    super('An account with this phone number already exists.', ErrorCode.PHONE_ALREADY_REGISTERED, 409);
  }
}

export class IdempotencyKeyReusedError extends DomainException {
  constructor() {
    super(
      'This Idempotency-Key was already used with a different request body.',
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      409,
    );
  }
}

export class RequestInProgressError extends DomainException {
  constructor(retryAfterSeconds = 1) {
    super('An identical request is already in progress.', ErrorCode.REQUEST_IN_PROGRESS, 409, {
      retryAfterSeconds,
    });
  }
}

// --------------------------------------------------------------- 429/503/500

export class RateLimitedError extends DomainException {
  constructor(readonly retryAfterSeconds: number, readonly limit: number) {
    super('Too many requests. Please retry shortly.', ErrorCode.RATE_LIMITED, 429, {
      retryAfterSeconds,
      limit,
    });
  }
}

export class DependencyUnavailableError extends DomainException {
  constructor(dependency: string, meta?: Record<string, unknown>) {
    super(`${dependency} is currently unavailable.`, ErrorCode.DEPENDENCY_UNAVAILABLE, 503, {
      dependency,
      ...meta,
    });
  }
}

/**
 * A configuration problem that must fail loudly rather than fall back.
 *
 * Used where a silent fallback would be a security hole — for example a missing
 * payment-gateway config must never resolve to a provider whose signature
 * verification is a no-op.
 */
export class ConfigurationError extends DomainException {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, ErrorCode.CONFIGURATION_ERROR, 500, meta);
  }
}

/** An order status change that the state machine forbids. */
export class InvalidTransitionError extends DomainException {
  constructor(entity: string, from: string, to: string) {
    super(
      `Cannot move ${entity} from ${from} to ${to}.`,
      ErrorCode.INVALID_TRANSITION,
      422,
      { entity, from, to },
    );
  }
}

export class UpgradeRequiredError extends DomainException {
  constructor(minimumVersion: string, platform: string) {
    super(
      'This app version is no longer supported. Please update to continue.',
      ErrorCode.UPGRADE_REQUIRED,
      426,
      { minimumVersion, platform },
    );
  }
}
