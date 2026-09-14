import type { Metadata } from 'next';

import { Placeholder } from '@/components/placeholder';

export const metadata: Metadata = {
  title: 'Search by salt',
  description:
    'Find every brand that contains a given salt combination, with fuzzy matching for typos.',
};

/**
 * Public salt search.
 *
 * The distinguishing feature of the platform: buyers search by composition, not by
 * brand. The normaliser that makes exact matching reliable already exists as
 * `@medichain/shared-utils`; the query adapter and the results UI arrive with
 * Phase 1.
 */
export default function SaltSearchPage() {
  return (
    <Placeholder
      title="Search by salt composition"
      description="Searching for a combination such as Paracetamol + Cetirizine, and typo-tolerant matching, arrives with Phase 1."
    />
  );
}
