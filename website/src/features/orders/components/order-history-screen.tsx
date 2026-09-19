'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription } from '@medichain/ui';
import { createOrdersApi } from '@medichain/api-client';
import Link from 'next/link';

import { callAuthed } from '@/features/auth/api';

/**
 * Order history.
 *
 * Split out of `app/(app)/orders/page.tsx` so that file can keep its `metadata`.
 *
 * `list` returns a page (`{ data, meta }`), not an array. The page size asked for
 * is the API's maximum, so the screen does not silently show only a first slice —
 * real paging belongs with the admin and reporting screens, where the volume
 * justifies the controls.
 */
export function OrderHistoryScreen() {
  const orders = useQuery({
    queryKey: ['orders', 'me'],
    queryFn: () => callAuthed((client) => createOrdersApi(client).list({ pageSize: 100 })),
  });

  if (orders.isPending) {
    return (
      <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />
    );
  }

  if (orders.isError || orders.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load order history</CardTitle>
          <CardDescription>Signing in again should fix it.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const userOrders = orders.data.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Order History</h1>

      {userOrders.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500">
            No orders yet. <Link href="/products" className="font-medium text-brand-700 hover:underline">
              Browse products to place your first order
            </Link>
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>

          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Order</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Date</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Status</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Total</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userOrders.map((order) => {
                  const statusMap: Record<string, string> = {
                    PLACED: 'Placed',
                    CONFIRMED: 'Confirmed',
                    DISPATCHED: 'Dispatched',
                    DELIVERED: 'Delivered',
                    CANCELLED: 'Cancelled',
                  };

                  return (
                    <tr key={order.id} className="border-b border-slate-100">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">#{order.id.slice(0, 8)}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="text-sm text-slate-500">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="font-medium text-slate-900">
                          {statusMap[order.status] || order.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="font-medium text-slate-900">
                          ₹{order.total.toString()}
                        </span>
                      </td>
                      <td className="p-3">
                        <Link
                          href={`/orders/${order.id}`}
                          className="text-sm text-brand-600 hover:underline"
                        >
                          Details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Link
        href="/products"
        className="mt-3 inline-block text-sm text-brand-600 hover:underline"
        type="button"
      >
        Browse products
      </Link>
    </div>
  );
}
