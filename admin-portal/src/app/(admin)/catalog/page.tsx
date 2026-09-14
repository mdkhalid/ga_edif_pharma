import type { Metadata } from 'next';

import { ModulePlaceholder } from '@/components/module-placeholder';

export const metadata: Metadata = { title: 'Catalogue' };

export default function CatalogPage() {
  return (
    <ModulePlaceholder
      title="Catalogue"
      capability="catalog:read"
      description="Product master, compositions, manufacturers and the bulk Excel import arrive with Phase 1. The salt curation UI belongs here too — bad salt data poisons search."
    />
  );
}
