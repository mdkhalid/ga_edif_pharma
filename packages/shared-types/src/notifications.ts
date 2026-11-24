import type { NotificationChannel } from './enums';

/** Transport shapes for the notification admin and self-service APIs. */

/** The channels a template can be written for (a subset of delivery channels). */
export type NotificationTemplateChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';

/** A reusable message template, as returned by `/notifications/templates`. */
export interface NotificationTemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly channel: NotificationTemplateChannel;
  readonly subject: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The channels a user currently receives. No row means "enabled". */
export interface NotificationPreferenceState {
  readonly enabled: readonly NotificationChannel[];
  readonly available: readonly NotificationChannel[];
}

export interface PushTokenMutationResult {
  readonly id: string;
}
