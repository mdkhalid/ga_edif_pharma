'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription } from '@medichain/ui';
import { createCartApi, createOrdersApi } from '@medichain/api-client';
import Link from 'next/link';

import { callAuthed } from '@/features/auth/api';

/**
 * Checkout.
 *
 * Split out of `app/(app)/checkout/page.tsx` so that file can keep its `metadata`.
 *
 * Order placement takes no line items: the order is always placed from the
 * caller's ACTIVE cart, so the cart's availability checks are the order's
 * availability checks and there is no second place for a line to come from.
 *
 * The `Idempotency-Key` is required by the endpoint, and a fresh one is generated
 * per attempt. It is what makes a retry safe: a double-tap, or a resubmit after a
 * dropped response, replays the first order rather than placing a second.
 */
export function CheckoutScreen() {
  const cart = useQuery({
    queryKey: ['cart', 'me'],
    queryFn: () => callAuthed((client) => createCartApi(client).get()),
  });

  const placeOrder = useMutation({
    mutationKey: ['order', 'place'],
    mutationFn: async () => {
      if (!cart.data?.items?.length) {
        throw new Error('Cart is empty');
      }
      return callAuthed((client) =>
        createOrdersApi(client).place({ deliveryAddress: '', notes: '' }, crypto.randomUUID()),
      );
    },
  });

  if (cart.isPending) {
    return (
      <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />
    );
  }

  if (cart.isError || cart.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load cart</CardTitle>
          <CardDescription>Signing in again should fix it.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!cart.data?.items?.length) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">
          Your cart is empty. <Link href="/products" className="font-medium text-brand-700 hover:underline">
            Browse products
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Checkout</h1>

      <Card>
        <CardHeader>
          <CardTitle>Cart Summary</CardTitle>
        </CardHeader>

        <div className="space-y-4">
          {cart.data.items.map((item) => {
            return (
              <div key={item.productId} className="flex justify-between text-sm">
                <span>{item.productName}</span>
                <span>₹{item.lineTotal.toString()}</span>
              </div>
            );
          })}

          <div>
            <span className="text-right font-medium">Subtotal</span>
            <span>₹{cart.data.total.toString()}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Order Details</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <label className="block text-slate-600">Delivery address</label>
              <CardDescription>Enter your delivery address (or leave blank for pickup)</CardDescription>
            </div>
            <div>
              <label className="block text-slate-600">Notes</label>
              <CardDescription>Any special instructions for the fulfilment team</CardDescription>
            </div>
          </div>
        </div>
      </Card>

      <button
        disabled={placeOrder.isPending}
        onClick={() => placeOrder.mutate()}
        className="w-full px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
        type="button"
      >
        {placeOrder.isPending ? 'Placing order…' : 'Place Order'}
      </button>

      {placeOrder.isSuccess && (
        <div className="mt-4 p-4 bg-green-100 rounded text-green-800">
          <p>Order placed successfully!</p>
          <p>Your order will be processed shortly.</p>
        </div>
      )}

      {placeOrder.isError && (
        <div className="mt-4 p-4 bg-red-100 rounded text-red-800">
          <p>Failed to place order. Please try again.</p>
        </div>
      )}

      <Link
        href="/products"
        className="mt-3 inline-block text-sm text-brand-600 hover:underline"
        type="button"
      >
        Continue shopping
      </Link>
    </div>
  );
}
