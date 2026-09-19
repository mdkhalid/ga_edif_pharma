'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription } from '@medichain/ui';
import { createCartApi } from '@medichain/api-client';
import Link from 'next/link';

import { callAuthed } from '@/features/auth/api';

/**
 * The cart.
 *
 * Split out of `app/(app)/cart/page.tsx` so that file can stay a server
 * component and keep its `metadata`: a `'use client'` page cannot export it.
 *
 * `callAuthed` takes a callback and hands it a client. That is what lets it
 * refresh once and retry on a 401, with the single-flight guard around the
 * refresh that makes concurrent 401s safe — so the call is passed as a closure
 * rather than the client being obtained first and used separately.
 */
export function CartScreen() {
  const cart = useQuery({
    queryKey: ['cart', 'me'],
    queryFn: () => callAuthed((client) => createCartApi(client).get()),
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

  const { items, total } = cart.data;

  if (items.length === 0) {
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
      <h1 className="text-2xl font-semibold text-slate-900">My Cart</h1>

      <div className="overflow-x-auto">
        <table className="w-full rounded border border-slate-200">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="p-3 text-left text-sm font-medium text-slate-600">Product</th>
              <th className="p-3 text-left text-sm font-medium text-slate-600">Qty</th>
              <th className="p-3 text-left text-sm font-medium text-slate-600">Price</th>
              <th className="p-3 text-left text-sm font-medium text-slate-600">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              return (
                <tr key={item.productId} className="border-b border-slate-100">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-slate-900">{item.productName}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      min="1"
                      value={Number(item.quantity)}
                      className="w-20 border rounded px-2"
                      readOnly
                    />
                  </td>
                  <td className="p-3">
                    <span className="font-medium text-slate-900">₹{item.unitPrice.toString()}</span>
                  </td>
                  <td className="p-3">
                    <span className="font-medium text-slate-900">₹{item.lineTotal.toString()}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-sm text-slate-500">Subtotal</span>
          <span className="font-medium text-slate-900">₹{total.toString()}</span>
        </div>
        <Link
          href="/checkout"
          className="col-span-2 px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 text-center"
        >
          Checkout
        </Link>
      </div>
    </div>
  );
}
