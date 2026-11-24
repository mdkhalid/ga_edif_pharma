/**
 * Push delivery port.
 *
 * The application layer (the notification centre, the order fan-out) needs to
 * reach a user's devices, but it must not know which gateway does the reaching.
 * This interface is that seam: the FCM/APNs implementation lives in
 * `infra/notifications`, and swapping it changes no application code — exactly
 * the split already used for email and SMS.
 *
 * It lives in `common/ports` for the same reason `notification.port.ts` does:
 * the adapter under `infra/` may not import a feature module's internals, so the
 * contract has to sit somewhere both sides may depend on.
 */

/** DI token for the push transport. */
export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT');

/** One message for one device token. */
export interface PushMessage {
  /** The provider-issued device token. */
  readonly token: string;
  readonly title: string;
  readonly body: string;
  /** Optional key/value payload the client uses to route the notification. */
  readonly data?: Record<string, string>;
}

export interface PushTransport {
  /**
   * Deliver one message. Rejects when the provider refused it, so the caller can
   * count failures and prune tokens the provider has told us are dead.
   */
  send(message: PushMessage): Promise<void>;
}
