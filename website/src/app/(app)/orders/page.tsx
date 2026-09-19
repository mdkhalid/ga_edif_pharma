import type { Metadata } from 'next';

import { OrderHistoryScreen } from '@/features/orders/components/order-history-screen';

export const metadata: Metadata = {
  title: 'Order History',
  description: 'Your past orders and order status.',
};

/**
 * Order history.
 *
 * A server component that only renders the screen, so it can keep its `metadata`.
 */
export default function OrdersPage() {
  return <OrderHistoryScreen />;
}
