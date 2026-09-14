import type { OtpPurpose } from '@medichain/shared-types';

/**
 * Outbound notification port.
 *
 * The application-layer services that need to deliver a one-time code depend on
 * this interface, not on an email or SMS client. There is no transport in Phase 0
 * — `notifications/` is an empty module and no SMTP/SMS provider is wired — so the
 * only adapter is a logging one (see `LogNotificationAdapter`). Binding a port
 * now means the real transport (SMTP for email, MSG91/Twilio for SMS) drops in
 * during Phase 1 by providing a different adapter, with no change to the auth
 * flows that emit codes.
 *
 * The port lives in `common/ports` rather than inside the `iam` module for the
 * same reason the other ports do: the adapter lives in `infra/`, and an
 * infrastructure file may not reach into a feature module's internals (the
 * module-boundary gate would reject it). Declaring what the application needs in
 * `common` keeps the dependency pointing the right way.
 */

/** DI token for the notification port. */
export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');

export interface OtpDelivery {
  /** Email address or phone number the code was sent to, normalised. */
  readonly destination: string;
  readonly purpose: OtpPurpose;
  /** The plaintext code. Never persisted — only its digest is stored. */
  readonly code: string;
  readonly expiresInMinutes: number;
}

export interface NotificationPort {
  /** Delivers a one-time code. Must not throw for an unknown destination. */
  sendOtp(delivery: OtpDelivery): Promise<void>;
}
