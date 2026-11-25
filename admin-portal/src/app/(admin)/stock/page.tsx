import type { Metadata } from 'next';

import { StockScreen } from '@/features/inventory/components/stock-screen';

export const metadata: Metadata = { title: 'Stock' };

export default function StockPage() {
  return <StockScreen />;
}
