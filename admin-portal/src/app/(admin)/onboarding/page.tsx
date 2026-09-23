import type { Metadata } from 'next';

import { OnboardingQueueScreen } from '@/features/onboarding/components/onboarding-queue-screen';

export const metadata: Metadata = { title: 'Onboarding' };

export default function OnboardingPage() {
  return <OnboardingQueueScreen />;
}
