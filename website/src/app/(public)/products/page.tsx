import type { Metadata } from 'next';

import { Placeholder } from '@/components/placeholder';

export const metadata: Metadata = {
  title: 'Catalogue',
  description: 'Browse medicines by brand, manufacturer and category.',
};

/**
 * Public catalogue landing.
 *
 * Server-rendered and indexable; the product list itself arrives with Phase 1, when
 * there is a catalogue to render and a search adapter behind it.
 */
export default function ProductsPage() {
  return (
    <Placeholder
      title="Catalogue"
      description="Product browse, categories and manufacturer pages arrive with Phase 1, along with the bulk import that populates them."
    />
  );
}
