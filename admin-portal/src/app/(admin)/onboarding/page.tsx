import type { Metadata } from 'next';

import { ModulePlaceholder } from '@/components/module-placeholder';

export const metadata: Metadata = { title: 'Onboarding' };

export default function OnboardingPage() {
  return (
    <ModulePlaceholder
      title="Onboarding"
      capability="onboarding:read"
      description="The buyer application review queue — approve, request more information, or reject — arrives with Phase 1, together with the document upload it reviews."
    />
  );
}
