'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';
import { ApiError, createCreditApi } from '@medichain/api-client';
import { OrganisationStatus, type OrganisationStatus as Status } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700 ring-green-600/20',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  SUSPENDED: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  BLOCKED: 'bg-red-50 text-red-700 ring-red-600/20',
};

/**
 * Credit-exposure viewer.
 *
 * Reports the balance the order transaction enforces, not a separate reporting
 * figure. There is no persisted credit ledger yet, so history is deliberately
 * absent from this screen — showing a reconstructed one would imply an audit
 * trail that does not exist.
 */
export function CreditScreen() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | Status>('ALL');
  const [page, setPage] = useState(1);

  const credit = useQuery({
    queryKey: ['credit', 'list', status, query, page],
    queryFn: () =>
      callAuthed((client) =>
        createCreditApi(client).list({
          status: status === 'ALL' ? undefined : status,
          search: query === '' ? undefined : query,
          page,
          pageSize: 25,
        }),
      ),
  });

  if (credit.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (credit.isError || credit.data === undefined) {
    const forbidden = credit.error instanceof ApiError && credit.error.isForbidden;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load credit summaries</CardTitle>
          <CardDescription>
            {forbidden
              ? 'Your role needs the credit:read capability.'
              : 'Signing in again should fix it.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pageData = credit.data;
  const rows = pageData.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Credit</h1>
        <p className="mt-1 text-sm text-slate-500">
          {pageData.meta.total} organisations. Available credit is the limit minus current
          exposure; order placement checks this same balance inside its transaction.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(String(new FormData(event.currentTarget).get('search') ?? '').trim());
          setPage(1);
        }}
      >
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="credit-search">
            Organisation name
          </label>
          <input
            id="credit-search"
            name="search"
            type="search"
            maxLength={200}
            defaultValue={query}
            placeholder="Legal or trade name"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="credit-status">
            Status
          </label>
          <select
            id="credit-status"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="ALL">All</option>
            {Object.values(OrganisationStatus).map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" type="submit">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No organisations match</CardTitle>
            <CardDescription>Try another name or status.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Credit exposure</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Organisation</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Status</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">Limit</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">Exposure</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">Available</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.organisationId} className="border-b border-slate-100">
                    <td className="p-3 text-sm font-medium text-slate-900">
                      {row.legalName}
                      {row.tradeName !== null && (
                        <span className="block text-xs font-normal text-slate-500">
                          {row.tradeName}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          STATUS_TONE[row.status] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'
                        }`}
                      >
                        {row.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="p-3 text-right text-sm text-slate-500">{row.creditLimit}</td>
                    <td className="p-3 text-right text-sm text-slate-500">{row.currentExposure}</td>
                    <td
                      className={`p-3 text-right text-sm font-medium ${
                        row.availableCredit === '0' || row.availableCredit === '0.0000'
                          ? 'text-danger-600'
                          : 'text-slate-900'
                      }`}
                    >
                      {row.availableCredit}
                    </td>
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
