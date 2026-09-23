'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardHeader, CardTitle, CardDescription, Input, Label } from '@medichain/ui';
import { createCatalogApi } from '@medichain/api-client';
import { Capability, ProductStatus, ScheduleClass } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';
import { usePermission } from '@/features/auth/use-permission';
import { CatalogueCreateForm } from './catalogue-create-form';
import { ProductEditDialog } from './product-edit-dialog';

const SCHEDULE_LABELS: Record<string, string> = {
  [ScheduleClass.OTC]: 'OTC',
  [ScheduleClass.H]: 'Schedule H',
  [ScheduleClass.H1]: 'Schedule H1',
  [ScheduleClass.X]: 'Schedule X',
  [ScheduleClass.NARCOTIC]: 'Narcotic',
};

const STATUS_LABELS: Record<string, string> = {
  [ProductStatus.ACTIVE]: 'Active',
  [ProductStatus.INACTIVE]: 'Inactive',
  [ProductStatus.ARCHIVED]: 'Archived',
};

const STATUS_TONE: Record<string, string> = {
  [ProductStatus.ACTIVE]: 'bg-green-50 text-green-700 ring-green-600/20',
  [ProductStatus.INACTIVE]: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  [ProductStatus.ARCHIVED]: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

/**
 * Catalogue browse, with create and edit wired to the backend that already
 * supports both.
 *
 * The reviewer needs the read side day to day — search by name and page through the
 * list — plus the ability to add a product and to correct a price or lifecycle
 * status without leaving the screen.
 */
export function CatalogueBrowseScreen() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { can } = usePermission();
  const canWrite = can(Capability.CATALOG_WRITE);

  const products = useQuery({
    queryKey: ['catalog', 'browse', search, page],
    queryFn: () =>
      callAuthed((client) => createCatalogApi(client).list({ search: search || undefined, page, pageSize: 25 })),
  });

  if (products.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (products.isError || products.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load the catalogue</CardTitle>
          <CardDescription>Signing in again should fix it.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pageData = products.data;
  const rows = pageData.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Catalogue</h1>
          <p className="mt-1 text-sm text-slate-500">
            {pageData.meta.total} product{pageData.meta.total === 1 ? '' : 's'} in the catalogue.
          </p>
        </div>
        {canWrite && !showCreate && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            New product
          </Button>
        )}
      </div>

      {canWrite && showCreate && (
        <CatalogueCreateForm
          onDone={() => {
            setShowCreate(false);
            setPage(1);
          }}
        />
      )}

      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="catalog-search">Search by name</Label>
        <Input
          id="catalog-search"
          value={search}
          placeholder="e.g. Paracetamol"
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No products match</CardTitle>
            <CardDescription>Try a different name.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Products</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Name</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Schedule</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Price</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Status</th>
                  {canWrite && <th className="p-3 text-left text-sm font-medium text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => (
                  <tr key={product.id} className="border-b border-slate-100">
                    <td className="p-3 text-sm font-medium text-slate-900">{product.name}</td>
                    <td className="p-3 text-sm text-slate-500">
                      {SCHEDULE_LABELS[product.schedule] ?? product.schedule}
                    </td>
                    <td className="p-3 text-sm text-slate-500">₹{product.price.toString()}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          STATUS_TONE[product.status] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'
                        }`}
                      >
                        {STATUS_LABELS[product.status] ?? product.status}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="p-3">
                        <Button size="sm" variant="secondary" onClick={() => setEditingId(product.id)}>
                          Edit
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canWrite && editingId !== null && rows.length > 0 && (() => {
        const product = rows.find((p) => p.id === editingId);
        if (product === undefined) return null;
        return <ProductEditDialog product={product} onClose={() => setEditingId(null)} />;
      })()}

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
