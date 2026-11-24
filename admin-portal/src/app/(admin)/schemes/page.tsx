import type { Metadata } from 'next';

import { SchemesScreen } from '@/features/schemes/components/schemes-screen';

export const metadata: Metadata = { title: 'Schemes' };

export default function SchemesPage() {
  return <SchemesScreen />;
}
