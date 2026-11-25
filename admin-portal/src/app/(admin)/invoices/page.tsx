import type { Metadata } from 'next';

import { InvoicesScreen } from '@/features/invoices/components/invoices-screen';

export const metadata: Metadata = { title: 'Invoices' };

export default function InvoicesPage() {
  return <InvoicesScreen />;
}
