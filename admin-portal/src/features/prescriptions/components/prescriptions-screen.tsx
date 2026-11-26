'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, createPrescriptionsApi } from '@medichain/api-client';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';
import { Capability, type PrescriptionStatus } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';
import { usePermission } from '@/features/auth/use-permission';

const STATUS_TONE: Record<string, string> = {
  PENDING_VERIFICATION: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  VERIFIED: 'bg-green-50 text-green-700 ring-green-600/20',
  REJECTED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  EXPIRED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

function formatDate(iso: string | null): string {
  return iso === null ? 'No expiry' : new Date(iso).toLocaleDateString();
}

/**
 * Pharmacist verification queue (B2).
 *
 * This reads the same `/prescriptions` list the order gate uses, so approving a
 * document here is what actually unlocks Schedule H/H1/X orders — there is no
 * second "approved" flag in the portal. The `prescription:verify` check below
 * only hides buttons; the API re-checks the capability on every request.
 */
export function PrescriptionsScreen() {
  const [status, setStatus] = useState<'ALL' | PrescriptionStatus>('ALL');
  const [page, setPage] = useState(1);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const { can } = usePermission();
  const canVerify = can(Capability.PRESCRIPTION_VERIFY);
  const queryClient = useQueryClient();

  const prescriptions = useQuery({
    queryKey: ['prescriptions', 'list', status, page],
    queryFn: () =>
      callAuthed((client) =>
        createPrescriptionsApi(client).list({
          status: status === 'ALL' ? undefined : status,
          page,
          pageSize: 25,
        }),
      ),
  });

  const verify = useMutation({
    mutationFn: (input: { id: string; decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
      callAuthed((client) =>
        createPrescriptionsApi(client).verify(input.id, {
          decision: input.decision,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        }),
      ),
    onSuccess: () => {
      setRejectingId(null);
      setReason('');
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
    },
    onError: (error: unknown) =>
      setActionError(
        error instanceof ApiError ? error.message : 'Could not update the prescription.',
      ),
  });

  if (prescriptions.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (prescriptions.isError || prescriptions.data === undefined) {
    const forbidden = prescriptions.error instanceof ApiError && prescriptions.error.isForbidden;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load prescriptions</CardTitle>
          <CardDescription>
            {forbidden
              ? 'Your role needs the prescription:read capability.'
              : 'Signing in again should fix it.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pageData = prescriptions.data;
  const rows = pageData.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Prescriptions</h1>
        <p className="mt-1 text-sm text-slate-500">
          {pageData.meta.total} document{pageData.meta.total === 1 ? '' : 's'}. Verifying one here
          is what allows the buyer to order Schedule H, H1, X and Narcotic products.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700" htmlFor="prescription-status">
          Status
        </label>
        <select
          id="prescription-status"
          className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="ALL">All</option>
          <option value="PENDING_VERIFICATION">Pending verification</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      {actionError !== null && <p className="text-sm text-danger-600">{actionError}</p>}

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing to review</CardTitle>
            <CardDescription>Try another status or come back later.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200 text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="p-3">Patient / reference</th>
                  <th className="p-3">Doctor</th>
                  <th className="p-3">Validity</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Dispensed</th>
                  {canVerify ? <th className="p-3">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-200">
                    <td className="p-3">
                      {row.patientRef ?? '—'}
                      <span className="block text-xs text-slate-500">
                        {row.referenceNumber ?? row.id.slice(0, 8)}
                      </span>
                    </td>
                    <td className="p-3">{row.doctorName ?? '—'}</td>
                    <td className="p-3">
                      {formatDate(row.validFrom)} – {formatDate(row.validTo)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ring-1 ${STATUS_TONE[row.status] ?? ''}`}
                      >
                        {row.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-3">
                      {row.dispensingCount} / {row.maxDispensings}
                    </td>
                    {canVerify ? (
                      <td className="p-3">
                        {row.status === 'PENDING_VERIFICATION' ? (
                          rejectingId === row.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                aria-label="Rejection reason"
                                className="h-9 rounded-[var(--radius-control)] border border-slate-300 px-2 text-sm"
                                maxLength={500}
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                placeholder="Reason for rejection"
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={reason.trim() === '' || verify.isPending}
                                onClick={() =>
                                  verify.mutate({
                                    id: row.id,
                                    decision: 'REJECT',
                                    reason: reason.trim(),
                                  })
                                }
                              >
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setRejectingId(null);
                                  setReason('');
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                loading={verify.isPending}
                                onClick={() => verify.mutate({ id: row.id, decision: 'APPROVE' })}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setRejectingId(row.id);
                                  setReason('');
                                }}
                              >
                                Reject
                              </Button>
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-slate-500">Already reviewed</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={!pageData.meta.hasPrev}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-slate-500">
          Page {pageData.meta.page} of {pageData.meta.totalPages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!pageData.meta.hasNext}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
