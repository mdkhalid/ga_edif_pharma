import type { Metadata } from 'next';

import { CreditScreen } from '@/features/credit/components/credit-screen';

export const metadata: Metadata = { title: 'Credit' };

export default function CreditPage() {
  return <CreditScreen />;
}
