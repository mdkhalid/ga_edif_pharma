'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardHeader, CardTitle, CardDescription } from '@medichain/ui';
import { createOrdersApi } from '@medichain/api-client';

import { callAuthed } from '@/features/auth/api';
import { OrderStatusBadge } from './order-status-badge';

const STATUS_LABELS: Record<string, string> = {
  PLACED: 'Placed',
  PENDING_APPROVAL: 'Pending approval',
  CONFIRMED: 'Confirmed',
  CREDIT_HOLD: 'Credit hold',
  PROCESSING: 'Processing',
  PARTIALLY_DISPATCHED: 'Partially dispatched',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery failed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  RETURN_REQUESTED: 'Return requested',
  RETURNED: 'Returned',
};

const PAYMENT_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  AUTHORIZED: 'Authorized',
  CAPTURED: 'Captured',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
  CANCELLED: 'Cancelled',
};

/** A single order's detail — header, payment state and its lines. */
export function OrderDetailScreen({ orderId }: { orderId: string }) {
  const router = useRouter();
  const order = useQuery({
    queryKey: ['orders', 'detail', orderId],
    queryFn: () => callAuthed((client) => createOrdersApi(client).getById(orderId)),
  });

  if (order.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (order.isError || order.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load this order</CardTitle>
          <CardDescription>The order may have been removed, or sign in again.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const detail = order.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Order #{detail.id.slice(0, 8)}</h1>
        </div>
        <OrderStatusBadge status={detail.status} label={STATUS_LABELS[detail.status] ?? detail.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>
            Payment: {PAYMENT_LABELS[detail.paymentStatus] ?? detail.paymentStatus} · Total ₹{detail.total.toString()}
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full rounded border border-slate-200">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="p-3 text-left text-sm font-medium text-slate-600">Product</th>
                <th className="p-3 text-left text-sm font-medium text-slate-600">Quantity</th>
                <th className="p-3 text-left text-sm font-medium text-slate-600">Unit price</th>
                <th className="p-3 text-left text-sm font-medium text-slate-600">Line total</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((line) => (
                <tr key={line.productId} className="border-b border-slate-100">
                  <td className="p-3 text-sm text-slate-900">{line.productName}</td>
                  <td className="p-3 text-sm text-slate-500">{line.quantity.toString()}</td>
                  <td className="p-3 text-sm text-slate-500">₹{line.price.toString()}</td>
                  <td className="p-3 text-sm font-medium text-slate-900">
                    ₹{(Number(line.price) * Number(line.quantity)).toString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Button size="sm" variant="secondary" onClick={() => router.back()}>
        Back
      </Button>
    </div>
  );
}
