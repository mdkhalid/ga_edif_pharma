'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';
import { ApiError, createStockApi } from '@medichain/api-client';

import { callAuthed } from '@/features/auth/api';

interface StockFilters {
  readonly productId: string;
  readonly warehouseId: string;
}

function formatExpiry(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

/**
 * Warehouse-stock viewer.
 *
 * Shows the authoritative stock rows with reservations and the database-derived
 * available quantity. FEFO allocation reads these same rows, so this is the
 * figure a picker will actually be able to allocate. No edits: stock moves only
 * through receipt, sale and adjustment transactions.
 */
export function StockScreen() {
  const [filters, setFilters] = useState<StockFilters>({ productId: '', warehouseId: '' });
  const [page, setPage] = useState(1);

  const stock = useQuery({
    queryKey: ['stock', 'list', filters.productId, filters.warehouseId, page],
    queryFn: () =>
      callAuthed((client) =>
        createStockApi(client).list({
          productId: filters.productId === '' ? undefined : filters.productId,
          warehouseId: filters.warehouseId === '' ? undefined : filters.warehouseId,
          page,
          pageSize: 25,
        }),
      ),
  });

  if (stock.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (stock.isError || stock.data === undefined) {
    const forbidden = stock.error instanceof ApiError && stock.error.isForbidden;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load stock</CardTitle>
          <CardDescription>
            {forbidden
              ? 'Your role needs the inventory:read capability.'
              : 'Signing in again should fix it.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pageData = stock.data;
  const rows = pageData.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Stock</h1>
        <p className="mt-1 text-sm text-slate-500">
          {pageData.meta.total} stock records. Available is on-hand minus what open orders have
          reserved, computed in decimal arithmetic by the database.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setFilters({
            productId: String(form.get('productId') ?? '').trim(),
            warehouseId: String(form.get('warehouseId') ?? '').trim(),
          });
          setPage(1);
        }}
      >
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="stock-product">
            Product id
          </label>
          <input
            id="stock-product"
            name="productId"
            maxLength={64}
            defaultValue={filters.productId}
            placeholder="Exact id"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="stock-warehouse">
            Warehouse id
          </label>
          <input
            id="stock-warehouse"
            name="warehouseId"
            maxLength={64}
            defaultValue={filters.warehouseId}
            placeholder="Exact id"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
          />
        </div>
        <Button size="sm" type="submit">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No stock records match</CardTitle>
            <CardDescription>Stock appears here after a receipt is posted.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Warehouse stock</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Product</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Warehouse</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Batch</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Expiry</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">On hand</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">Reserved</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">Available</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="p-3 text-sm font-medium text-slate-900">
                      {row.productName ?? (
                        <span className="font-mono text-xs text-slate-500">{row.productId}</span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs text-slate-500">{row.warehouseId}</td>
                    <td className="p-3 text-sm text-slate-500">{row.batchId ?? '—'}</td>
                    <td className="p-3 text-sm text-slate-500">{formatExpiry(row.expiryDate)}</td>
                    <td className="p-3 text-right text-sm text-slate-500">{row.quantity}</td>
                    <td className="p-3 text-right text-sm text-slate-500">{row.reserved}</td>
                    <td className="p-3 text-right text-sm font-medium text-slate-900">
                      {row.available}
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
