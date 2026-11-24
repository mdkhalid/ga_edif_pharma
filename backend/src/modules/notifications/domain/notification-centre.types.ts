export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  'IN_APP',
  'EMAIL',
  'SMS',
  'PUSH',
];

export interface InAppNotification {
  readonly id: string;
  readonly tenantId: string;
  readonly recipientId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly metadata: unknown;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}
