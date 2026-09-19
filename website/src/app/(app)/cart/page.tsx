import type { Metadata } from 'next';

import { CartScreen } from '@/features/cart/components/cart-screen';

export const metadata: Metadata = {
  title: 'Cart',
  description: 'Your shopping cart with live pricing and availability.',
};

/**
 * Cart.
 *
 * A server component that only renders the screen, so it can keep its `metadata`:
 * a `'use client'` page cannot export it. Same split as the catalogue.
 */
export default function CartPage() {
  return <CartScreen />;
}
