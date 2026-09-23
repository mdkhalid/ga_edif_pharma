import type { Metadata } from 'next';

import { OrdersScreen } from '@/features/orders/components/orders-screen';

export const metadata: Metadata = { title: 'Orders' };

export default function OrdersPage() {
  return <OrdersScreen />;
}
