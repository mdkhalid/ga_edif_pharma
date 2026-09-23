import { cn } from '@medichain/ui';

import type { OrderStatus } from '@medichain/shared-types';
import { TERMINAL_ORDER_STATUSES } from '@medichain/shared-types';

const TONE: Record<string, string> = {
  PLACED: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  CONFIRMED: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  CREDIT_HOLD: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  PROCESSING: 'bg-purple-50 text-purple-700 ring-purple-600/20',
  PARTIALLY_DISPATCHED: 'bg-purple-50 text-purple-700 ring-purple-600/20',
  DISPATCHED: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
  DELIVERED: 'bg-green-50 text-green-700 ring-green-600/20',
  DELIVERY_FAILED: 'bg-red-50 text-red-700 ring-red-600/20',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  REJECTED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  RETURN_REQUESTED: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  RETURNED: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

/**
 * A status pill for order rows.
 *
 * Colour is derived from the status, not the caller, so every list agrees on what
 * "delivered" looks like. Terminal statuses (cancelled, rejected, returned) use a
 * neutral tone so an active order still stands out in a long list.
 */
export function OrderStatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  const tone = TONE[status] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tone,
      )}
    >
      {label}
    </span>
  );
}

/** Exposed so non-order screens can mark a row terminal without re-deriving it. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}
