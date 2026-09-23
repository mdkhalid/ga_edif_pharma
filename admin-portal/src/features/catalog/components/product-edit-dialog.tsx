'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label } from '@medichain/ui';
import { createCatalogApi } from '@medichain/api-client';
import { ProductStatus, type ProductSummary } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

const STATUSES: readonly ProductStatus[] = [
  ProductStatus.ACTIVE,
  ProductStatus.INACTIVE,
  ProductStatus.ARCHIVED,
];

/**
 * Inline editor for a catalogue product.
 *
 * `UpdateProductDto` allows `name`, `price` and `status` to change
 * independently; this editor exposes the two an admin changes day to day — price
 * and lifecycle status. Name changes are rarer and intentionally left to a later
 * slice. Status is a real business control (archived withdraws a product without
 * deleting it, so old order lines still resolve).
 */
export function ProductEditDialog({
  product,
  onClose,
}: {
  product: ProductSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(product.price.toString());
  const [status, setStatus] = useState<ProductStatus>(product.status);
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: () =>
      callAuthed((client) =>
        createCatalogApi(client).update(product.id, {
          price: Number(price),
          status,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'browse'] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not update the product.'),
  });

  return (
    <form
      className="space-y-3 rounded-[var(--radius-card)] border border-slate-200 bg-slate-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (Number.isNaN(Number(price))) {
          setError('Price must be a number.');
          return;
        }
        update.mutate();
      }}
    >
      <p className="text-sm font-medium text-slate-900">{product.name}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-price">Price (₹)</Label>
          <Input id="edit-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-status">Status</Label>
          <select
            id="edit-status"
            className="h-10 w-full rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProductStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error !== null && <p className="text-sm text-danger-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
