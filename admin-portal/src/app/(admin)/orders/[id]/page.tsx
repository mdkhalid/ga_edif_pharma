import type { Metadata } from 'next';

import { OrderDetailScreen } from '@/features/orders/components/order-detail-screen';

export const metadata: Metadata = { title: 'Order' };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderDetailScreen orderId={id} />;
}
