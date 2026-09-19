import type { Metadata } from 'next';

import { CheckoutScreen } from '@/features/orders/components/checkout-screen';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Place your order from the cart.',
};

/**
 * Checkout.
 *
 * A server component that only renders the screen, so it can keep its `metadata`.
 */
export default function CheckoutPage() {
  return <CheckoutScreen />;
}
