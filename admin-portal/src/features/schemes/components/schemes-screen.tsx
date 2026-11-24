'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHeader, CardTitle, CardDescription } from '@medichain/ui';
import { createSchemesApi } from '@medichain/api-client';
import { Capability } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';
import { usePermission } from '@/features/auth/use-permission';
import { SchemeForm } from './scheme-form';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700 ring-green-600/20',
  INACTIVE: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

function formatWindow(from: string, to: string): string {
  const start = new Date(from).toLocaleDateString();
  const end = new Date(to).toLocaleDateString();
  return `${start} – ${end}`;
}

/**
 * Scheme administration.
 *
 * Reads the persisted schemes the pricing engine actually resolves, so what an
 * admin sees here is what will be applied at checkout — not a copy in a CMS.
 * Writes are gated on `SCHEME_WRITE` in the UI as a courtesy; the API enforces it.
 */
export function SchemesScreen() {
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [kind, setKind] = useState('ALL');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { can } = usePermission();
  const canWrite = can(Capability.SCHEME_WRITE);
  const queryClient = useQueryClient();

  const schemes = useQuery({
    queryKey: ['schemes', 'list', status, kind, page],
    queryFn: () =>
      callAuthed((client) =>
        createSchemesApi(client).list({
          status: status === 'ALL' ? undefined : status,
          kind: kind === 'ALL' ? undefined : (kind as 'PERCENTAGE' | 'FLAT' | 'FREE_GOODS' | 'COMBO'),
          page,
          pageSize: 25,
        }),
      ),
  });

  const archive = useMutation({
    mutationFn: (id: string) => callAuthed((client) => createSchemesApi(client).archive(id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['schemes'] }),
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : 'Could not archive the scheme.'),
  });

  if (schemes.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (schemes.isError || schemes.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load schemes</CardTitle>
          <CardDescription>Signing in again should fix it.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pageData = schemes.data;
  const rows = pageData.data;
  const editing = rows.find((row) => row.id === editingId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Schemes</h1>
          <p className="mt-1 text-sm text-slate-500">
            {pageData.meta.total} scheme{pageData.meta.total === 1 ? '' : 's'} configured. These
            are the offers the pricing engine applies to orders.
          </p>
        </div>
        {canWrite && !showCreate && editing === undefined && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            New scheme
          </Button>
        )}
      </div>

      {actionError !== null && <p className="text-sm text-danger-600">{actionError}</p>}

      {canWrite && showCreate && (
        <SchemeForm
          onDone={() => {
            setShowCreate(false);
            setPage(1);
          }}
        />
      )}

      {canWrite && editing !== undefined && (
        <SchemeForm
          scheme={editing}
          onDone={() => {
            setEditingId(null);
            setPage(1);
          }}
        />
      )}

      <div className="flex flex-wrap gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="scheme-status-filter">
            Status
          </label>
          <select
            id="scheme-status-filter"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="scheme-kind-filter">
            Kind
          </label>
          <select
            id="scheme-kind-filter"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All</option>
            <option value="PERCENTAGE">Percentage</option>
            <option value="FLAT">Flat</option>
            <option value="FREE_GOODS">Free goods</option>
            <option value="COMBO">Combo</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No schemes match</CardTitle>
            <CardDescription>Try another status or kind, or create one.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Configured schemes</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Name</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Kind</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Value</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Window</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Priority</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Status</th>
                  {canWrite && (
                    <th className="p-3 text-left text-sm font-medium text-slate-600">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((scheme) => (
                  <tr key={scheme.id} className="border-b border-slate-100">
                    <td className="p-3 text-sm font-medium text-slate-900">{scheme.name}</td>
                    <td className="p-3 text-sm text-slate-500">{scheme.kind.replace('_', ' ')}</td>
                    <td className="p-3 text-sm text-slate-500">
                      {scheme.kind === 'PERCENTAGE' && scheme.percentOff !== null
                        ? `${scheme.percentOff}%`
                        : scheme.kind === 'FLAT' && scheme.flatOff !== null
                          ? `₹${scheme.flatOff}`
                          : scheme.kind === 'FREE_GOODS'
                            ? `${scheme.buyQty ?? '–'} + ${scheme.freeQty ?? '–'}`
                            : scheme.comboProductIds.length > 0
                              ? `${scheme.comboProductIds.length} products`
                              : '–'}
                    </td>
                    <td className="p-3 text-sm text-slate-500">
                      {formatWindow(scheme.validFrom, scheme.validTo)}
                    </td>
                    <td className="p-3 text-sm text-slate-500">{scheme.priority}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          STATUS_TONE[scheme.status] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'
                        }`}
                      >
                        {STATUS_LABELS[scheme.status] ?? scheme.status}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="p-3">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingId(scheme.id);
                              setShowCreate(false);
                            }}
                          >
                            Edit
                          </Button>
                          {scheme.status === 'ACTIVE' && (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={archive.isPending}
                              onClick={() => {
                                if (window.confirm(`Archive “${scheme.name}”?`)) {
                                  archive.mutate(scheme.id);
                                }
                              }}
                            >
                              Archive
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          Page {pageData.meta.page} of {pageData.meta.totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!pageData.meta.hasPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!pageData.meta.hasNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
