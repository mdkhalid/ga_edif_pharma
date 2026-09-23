import type { Metadata } from 'next';

import { CatalogueBrowseScreen } from '@/features/catalog/components/catalogue-browse-screen';

export const metadata: Metadata = { title: 'Catalogue' };

export default function CatalogPage() {
  return <CatalogueBrowseScreen />;
}
