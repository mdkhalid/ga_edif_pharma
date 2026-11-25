'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';
import { ApiError, createPriceListsApi } from '@medichain/api-client';
import type { PriceListStatus } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700 ring-green-600/20',
  DRAFT: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  ARCHIVED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/**
 * Price-list viewer.
 *
 * The list the pricing engine resolves is the one shown here — there is no
 * second copy in the admin portal. Opening a row fetches its tiered lines and
 * customer assignments from the same read API, so an operator can answer "why
 * did this buyer get that price?" without querying the database.
 *
 * Read-only by design: the API requires `pricing:read`, and the nav entry is
 * hidden from roles without it. Hiding the link is courtesy, not access control.
 */
export function PriceListsScreen() {
  const [status, setStatus] = useState<'ALL' | PriceListStatus>('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const priceLists = useQuery({
    queryKey: ['price-lists', 'list', status, query, page],
    queryFn: () =>
      callAuthed((client) =>
        createPriceListsApi(client).list({
          status: status === 'ALL' ? undefined : status,
          search: query === '' ? undefined : query,
          page,
          pageSize: 25,
        }),
      ),
  });

  const detail = useQuery({
    queryKey: ['price-lists', 'detail', openId],
    enabled: openId !== null,
    queryFn: () => callAuthed((client) => createPriceListsApi(client).getById(openId as string)),
  });

  if (priceLists.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (priceLists.isError || priceLists.data === undefined) {
    const forbidden = priceLists.error instanceof ApiError && priceLists.error.isForbidden;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load price lists</CardTitle>
          <CardDescription>
            {forbidden
              ? 'Your role needs the pricing:read capability.'
              : 'Signing in again should fix it.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pageData = priceLists.data;
  const rows = pageData.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Price lists</h1>
        <p className="mt-1 text-sm text-slate-500">
          {pageData.meta.total} active and past lists. Prices here are the ones orders are priced
          with, not a separate catalogue copy.
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
          <label className="block text-sm font-medium text-slate-700" htmlFor="price-list-search">
            Name contains
          </label>
          <input
            id="price-list-search"
            name="search"
            type="search"
            maxLength={200}
            defaultValue={query}
            placeholder="Wholesale Q4"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="price-list-status">
            Status
          </label>
          <select
            id="price-list-status"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <Button size="sm" type="submit">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No price lists match</CardTitle>
            <CardDescription>Try another name or status.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Configured price lists</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Name</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Status</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Effective</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">Lines</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">Customers</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((list) => (
                  <tr key={list.id} className="border-b border-slate-100">
                    <td className="p-3 text-sm font-medium text-slate-900">{list.name}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          STATUS_TONE[list.status] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'
                        }`}
                      >
                        {list.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-slate-500">
                      {formatDate(list.effectiveFrom)} – {formatDate(list.effectiveTo)}
                    </td>
                    <td className="p-3 text-right text-sm text-slate-500">{list.lineCount}</td>
                    <td className="p-3 text-right text-sm text-slate-500">{list.customerCount}</td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setOpenId(openId === list.id ? null : list.id)}
                      >
                        {openId === list.id ? 'Hide details' : 'Details'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {openId !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Price-list details</CardTitle>
            <CardDescription>
              Tiers are the minimum quantities at which each unit price applies.
            </CardDescription>
          </CardHeader>
          {detail.isPending ? (
            <p className="px-6 pb-6 text-sm text-slate-500">Loading details…</p>
          ) : detail.isError || detail.data === undefined ? (
            <p className="px-6 pb-6 text-sm text-danger-600">Could not load this price list.</p>
          ) : (
            <div className="space-y-6 px-6 pb-6">
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <span className="text-slate-500">
                  Assigned customers:{' '}
                  <span className="font-medium text-slate-900">
                    {detail.data.customerOrganisationIds.length}
                  </span>
                </span>
                <span className="text-slate-500">
                  Updated:{' '}
                  <span className="font-medium text-slate-900">
                    {new Date(detail.data.updatedAt).toLocaleString()}
                  </span>
                </span>
              </div>
              {detail.data.lines.length === 0 ? (
                <p className="text-sm text-slate-500">This list has no lines yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full rounded border border-slate-200">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="p-3 text-left text-sm font-medium text-slate-600">Product</th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">Min qty</th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">
                          Unit price
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.lines.map((line) => (
                        <tr key={line.id} className="border-b border-slate-100">
                          <td className="p-3 text-sm text-slate-900">
                            {line.productName ?? <span className="font-mono text-xs">{line.productId}</span>}
                          </td>
                          <td className="p-3 text-right text-sm text-slate-500">{line.minQty}</td>
                          <td className="p-3 text-right text-sm font-medium text-slate-900">
                            ₹{line.unitPrice}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
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
