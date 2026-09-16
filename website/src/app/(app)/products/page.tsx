import type { Metadata } from 'next';

import { CatalogueScreen } from '@/features/catalog/components/catalogue-screen';

export const metadata: Metadata = {
  title: 'Catalogue',
  description: 'Browse medicines by brand, with live prices and availability.',
};

/**
 * Catalogue browse.
 *
 * ## Why this is behind sign-in rather than a public page
 *
 * It was written as a public, crawlable page, and it cannot be one. The endpoint
 * requires `catalog:read`, every price is resolved per organisation, and
 * availability is live warehouse stock — none of which may be served to an
 * anonymous visitor. Until there is a deliberately public catalogue endpoint, the
 * storefront is an authenticated area, and the route lives with the rest of the
 * authenticated app so it gets the app shell and the guard.
 *
 * The component is split out so this file can stay a server component and keep its
 * `metadata`: a `'use client'` page cannot export it, and an untitled tab in a
 * signed-in app is a small thing that is still worth having.
 */
export default function ProductsPage() {
  return <CatalogueScreen />;
}
