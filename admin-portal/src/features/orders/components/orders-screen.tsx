'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHeader, CardTitle, CardDescription } from '@medichain/ui';
import { createOrdersApi } from '@medichain/api-client';
import type { OrderStatus } from '@medichain/shared-types';
import { Capability, ORDER_TRANSITIONS } from '@medichain/shared-types';
import Link from 'next/link';

import { callAuthed } from '@/features/auth/api';
import { usePermission } from '@/features/auth/use-permission';
import { OrderStatusBadge } from './order-status-badge';

/** The five fulfilment actions the orders client exposes. */
type OrderAction = 'confirm' | 'process' | 'dispatch' | 'deliver' | 'cancel';

/** The state-machine target each action moves an order to. */
const TARGET_ACTION: Readonly<Partial<Record<OrderStatus, OrderAction>>> = {
  CONFIRMED: 'confirm',
  PROCESSING: 'process',
  DISPATCHED: 'dispatch',
  DELIVERED: 'deliver',
  CANCELLED: 'cancel',
};

const ACTION_LABEL: Record<OrderAction, string> = {
  confirm: 'Confirm',
  process: 'Process',
  dispatch: 'Dispatch',
  deliver: 'Deliver',
  cancel: 'Cancel',
};

/** Which capability guards each action — the API enforces the same set. */
const ACTION_CAPABILITY: Record<OrderAction, Capability> = {
  confirm: Capability.ORDER_APPROVE,
  process: Capability.ORDER_APPROVE,
  dispatch: Capability.ORDER_APPROVE,
  deliver: Capability.ORDER_APPROVE,
  cancel: Capability.ORDER_CANCEL,
};

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

/**
 * The tenant order list with manual fulfilment transitions.
 *
 * Lists every order in the tenant and offers the transitions the state machine
 * allows from each order's current status. The available actions are derived from
 * `ORDER_TRANSITIONS` and the client's five transition methods — a target with no
 * client method (e.g. `PENDING_APPROVAL`) simply shows no button. Each action is
 * capability-gated; the backend still enforces it.
 */
export function OrdersScreen() {
  const queryClient = useQueryClient();
  const { can } = usePermission();

  const orders = useQuery({
    queryKey: ['orders', 'tenant'],
    queryFn: () => callAuthed((client) => createOrdersApi(client).list({ pageSize: 100 })),
  });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: OrderAction }) =>
      callAuthed((client) => {
        const api = createOrdersApi(client);
        const run: Record<OrderAction, () => Promise<unknown>> = {
          confirm: () => api.confirm(id),
          process: () => api.process(id),
          dispatch: () => api.dispatch(id),
          deliver: () => api.deliver(id),
          cancel: () => api.cancel(id),
        };
        return run[action]();
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders', 'tenant'] });
    },
  });

  if (orders.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (orders.isError || orders.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load orders</CardTitle>
          <CardDescription>Signing in again should fix it.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows = orders.data.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Orders</h1>
        <p className="mt-1 text-sm text-slate-500">Every order in the tenant, with manual fulfilment.</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No orders yet</CardTitle>
            <CardDescription>Orders placed from the website or mobile app appear here.</CardDescription>
          </CardHeader>
        </Card>
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
                {rows.map((order) => {
                  const actions = (ORDER_TRANSITIONS[order.status] ?? [])
                    .map((target) => TARGET_ACTION[target])
                    .filter((action): action is OrderAction => action !== undefined)
                    .filter((action) => can(ACTION_CAPABILITY[action]));

                  return (
                    <tr key={order.id} className="border-b border-slate-100">
                      <td className="p-3 font-mono text-sm text-slate-900">#{order.id.slice(0, 8)}</td>
                      <td className="p-3 text-sm text-slate-500">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        <OrderStatusBadge status={order.status} label={STATUS_LABELS[order.status] ?? order.status} />
                      </td>
                      <td className="p-3 font-medium text-slate-900">₹{order.total.toString()}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/orders/${order.id}`}
                            className="text-sm text-brand-600 hover:underline"
                          >
                            Details
                          </Link>
                          {actions.length === 0 ? (
                            <span className="text-xs text-slate-400">No actions</span>
                          ) : (
                            actions.map((action) => (
                              <Button
                                key={action}
                                size="sm"
                                variant={action === 'cancel' ? 'secondary' : 'primary'}
                                disabled={transition.isPending}
                                onClick={() => transition.mutate({ id: order.id, action })}
                              >
                                {transition.isPending ? '…' : ACTION_LABEL[action]}
                              </Button>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
