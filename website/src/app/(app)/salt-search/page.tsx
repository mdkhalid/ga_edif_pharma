import type { Metadata } from 'next';

import { SaltSearchScreen } from '@/features/search/components/salt-search-screen';

export const metadata: Metadata = {
  title: 'Search by salt',
  description: 'Find every brand that contains a given salt combination.',
};

/**
 * Salt-combination search.
 *
 * Authenticated for the same reason as the catalogue: the endpoint requires
 * `salt:read`, and a result carries a price. The screen is a client component so
 * this one can keep its `metadata`.
 */
export default function SaltSearchPage() {
  return <SaltSearchScreen />;
}
