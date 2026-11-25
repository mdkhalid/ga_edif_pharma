import type { Metadata } from 'next';

import { PriceListsScreen } from '@/features/pricing/components/price-lists-screen';

export const metadata: Metadata = { title: 'Price lists' };

export default function PriceListsPage() {
  return <PriceListsScreen />;
}
