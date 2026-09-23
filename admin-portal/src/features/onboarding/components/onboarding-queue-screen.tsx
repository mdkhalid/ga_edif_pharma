'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHeader, CardTitle, CardDescription } from '@medichain/ui';
import { createOnboardingApi } from '@medichain/api-client';
import type { OnboardingApplicationSummary } from '@medichain/shared-types';
import { Capability, OrgType } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';
import { usePermission } from '@/features/auth/use-permission';

const ORG_TYPE_LABELS: Record<string, string> = {
  [OrgType.DISTRIBUTOR]: 'Distributor',
  [OrgType.WHOLESALER]: 'Wholesaler',
  [OrgType.PHARMACY]: 'Pharmacy',
  [OrgType.HOSPITAL]: 'Hospital',
};

/**
 * The buyer application review queue.
 *
 * Lists every organisation awaiting a decision (`listPending`, oldest first) and
 * lets a reviewer approve or reject each. Approve provisions the organisation's
 * first administrator in one transaction on the backend; the UI only triggers it.
 *
 * The actions are gated on the review/approve capabilities — the API enforces the
 * same, so this is courtesy, not control. A reviewer without `onboarding:approve`
 * simply never sees the button.
 */
export function OnboardingQueueScreen() {
  const queryClient = useQueryClient();
  const { can } = usePermission();
  const canReview = can(Capability.ONBOARDING_REVIEW);
  const canApprove = can(Capability.ONBOARDING_APPROVE);

  const applications = useQuery({
    queryKey: ['onboarding', 'pending'],
    queryFn: () => callAuthed((client) => createOnboardingApi(client).listPending()),
  });

  const onSettled = () => {
    void queryClient.invalidateQueries({ queryKey: ['onboarding', 'pending'] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => callAuthed((client) => createOnboardingApi(client).approve(id)),
    onSettled,
  });

  const reject = useMutation({
    mutationFn: (id: string) => callAuthed((client) => createOnboardingApi(client).reject(id)),
    onSettled,
  });

  if (applications.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (applications.isError || applications.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load the application queue</CardTitle>
          <CardDescription>Signing in again should fix it.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows: readonly OnboardingApplicationSummary[] = applications.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Onboarding</h1>
        <p className="mt-1 text-sm text-slate-500">
          Distributor and pharmacy applications awaiting a decision.
        </p>
      </div>

      {!canReview && (
        <Card>
          <CardHeader>
            <CardTitle>Read-only</CardTitle>
            <CardDescription>
              Your role can view applications but not decide them.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing pending</CardTitle>
            <CardDescription>Every application has been decided.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((application) => (
            <ApplicationCard
              key={application.id}
              application={application}
              canApprove={canApprove}
              onApprove={() => approve.mutate(application.id)}
              onReject={() => reject.mutate(application.id)}
              approving={approve.isPending}
              rejecting={reject.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationCard({
  application,
  canApprove,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  application: OnboardingApplicationSummary;
  canApprove: boolean;
  onApprove: () => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{application.legalName}</CardTitle>
            <CardDescription>
              {ORG_TYPE_LABELS[application.type] ?? application.type} · applied{' '}
              {new Date(application.createdAt).toLocaleDateString()}
            </CardDescription>
          </div>
          {canApprove && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={approving || rejecting}
                onClick={onReject}
              >
                {rejecting ? 'Rejecting…' : 'Reject'}
              </Button>
              <Button size="sm" disabled={approving || rejecting} onClick={onApprove}>
                {approving ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          )}
        </div>
        <p className="mt-2 font-mono text-xs text-slate-400">#{application.id.slice(0, 8)}</p>
      </CardHeader>
    </Card>
  );
}
