import type { Metadata } from 'next';

import { ModulePlaceholder } from '@/components/module-placeholder';

export const metadata: Metadata = { title: 'Orders' };

export default function OrdersPage() {
  return (
    <ModulePlaceholder
      title="Orders"
      capability="order:read"
      description="The order list, detail view and manual status transitions arrive with Phase 1, once orders can be placed from the website and the mobile app."
    />
  );
}
