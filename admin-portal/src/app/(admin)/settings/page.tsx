import type { Metadata } from 'next';

import { ModulePlaceholder } from '@/components/module-placeholder';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <ModulePlaceholder
      title="Settings"
      capability="settings:read"
      description="Runtime configuration — AI providers, payment gateways, notification providers and feature flags — arrives with Phases 2 and 5. Every change will be audited, secrets write-only, and live within 30 seconds with no redeploy."
    />
  );
}
