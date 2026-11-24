import type { Metadata } from 'next';

import { NotificationTemplatesScreen } from '@/features/notifications/components/notification-templates-screen';

export const metadata: Metadata = { title: 'Notification templates' };

export default function NotificationTemplatesPage() {
  return <NotificationTemplatesScreen />;
}
