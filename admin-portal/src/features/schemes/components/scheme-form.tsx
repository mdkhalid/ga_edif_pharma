'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label } from '@medichain/ui';
import { createSchemesApi } from '@medichain/api-client';
import type { SchemeKind, SchemeSummary } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

const KINDS: readonly SchemeKind[] = ['PERCENTAGE', 'FLAT', 'FREE_GOODS', 'COMBO'];

/** `datetime-local` shows `YYYY-MM-DDTHH:mm`; the API carries full ISO UTC. */
function toDateTimeLocal(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16);
}

function toIso(local: string): string {
  return new Date(`${local}:00Z`).toISOString();
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}

function defaultFrom(): string {
  return new Date().toISOString().slice(0, 16);
}

function defaultTo(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 16);
}

/**
 * Create or edit a scheme.
 *
 * Kind, product and category targets are create-only: the update DTO deliberately
 * cannot change what a scheme applies to, because that changes its meaning (and
 * therefore the discount already given on past orders). Editing changes wording,
 * value, window, priority and status only.
 */
export function SchemeForm({
  scheme,
  onDone,
}: {
  scheme?: SchemeSummary;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = scheme !== undefined;

  const [name, setName] = useState(scheme?.name ?? '');
  const [kind, setKind] = useState<SchemeKind>(scheme?.kind ?? 'PERCENTAGE');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(scheme?.status ?? 'ACTIVE');
  const [productId, setProductId] = useState(scheme?.productId ?? '');
  const [categoryId, setCategoryId] = useState(scheme?.categoryId ?? '');
  const [percentOff, setPercentOff] = useState(scheme?.percentOff?.toString() ?? '');
  const [flatOff, setFlatOff] = useState(scheme?.flatOff?.toString() ?? '');
  const [minQty, setMinQty] = useState(scheme?.minQty?.toString() ?? '');
  const [buyQty, setBuyQty] = useState(scheme?.buyQty?.toString() ?? '');
  const [freeQty, setFreeQty] = useState(scheme?.freeQty?.toString() ?? '');
  const [comboProductIds, setComboProductIds] = useState(scheme?.comboProductIds.join(', ') ?? '');
  const [validFrom, setValidFrom] = useState(
    scheme ? toDateTimeLocal(scheme.validFrom) : defaultFrom(),
  );
  const [validTo, setValidTo] = useState(scheme ? toDateTimeLocal(scheme.validTo) : defaultTo());
  const [stackable, setStackable] = useState(scheme?.stackable ?? true);
  const [priority, setPriority] = useState((scheme?.priority ?? 1).toString());
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const common = {
        name: name.trim(),
        percentOff: optionalNumber(percentOff),
        flatOff: optionalNumber(flatOff),
        minQty: optionalNumber(minQty),
        buyQty: optionalNumber(buyQty),
        freeQty: optionalNumber(freeQty),
        comboProductIds:
          comboProductIds.trim() === ''
            ? undefined
            : comboProductIds.split(',').map((id) => id.trim()),
        validFrom: toIso(validFrom),
        validTo: toIso(validTo),
        stackable,
        priority: Number(priority),
      };

      return callAuthed(async (client) => {
        const api = createSchemesApi(client);
        if (editing) {
          await api.update(scheme.id, { ...common, status });
          return;
        }
        await api.create({
          ...common,
          kind,
          productId: productId.trim() === '' ? undefined : productId.trim(),
          categoryId: categoryId.trim() === '' ? undefined : categoryId.trim(),
        });
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schemes'] });
      onDone();
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : 'Could not save the scheme.'),
  });

  return (
    <form
      className="space-y-4 rounded-[var(--radius-card)] border border-slate-200 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (name.trim() === '') {
          setError('A name is required.');
          return;
        }
        if (validFrom === '' || validTo === '') {
          setError('Valid from and valid to are required.');
          return;
        }
        if (new Date(toIso(validTo)) < new Date(toIso(validFrom))) {
          setError('Valid to must be on or after valid from.');
          return;
        }
        if (priority.trim() === '' || Number.isNaN(Number(priority))) {
          setError('Priority must be a number.');
          return;
        }
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="scheme-name">Name</Label>
          <Input id="scheme-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="scheme-kind">Kind{editing ? ' (fixed after creation)' : ''}</Label>
          <select
            id="scheme-kind"
            className="h-10 w-full rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
            value={kind}
            disabled={editing}
            onChange={(e) => setKind(e.target.value as SchemeKind)}
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        {editing ? (
          <div className="space-y-1.5">
            <Label htmlFor="scheme-status">Status</Label>
            <select
              id="scheme-status"
              className="h-10 w-full rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="scheme-product">Product id (optional)</Label>
              <Input
                id="scheme-product"
                placeholder="UUID"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scheme-category">Category id (optional)</Label>
              <Input
                id="scheme-category"
                placeholder="UUID"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="scheme-percent">Percent off (%)</Label>
          <Input
            id="scheme-percent"
            inputMode="decimal"
            value={percentOff}
            onChange={(e) => setPercentOff(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheme-flat">Flat off (₹)</Label>
          <Input
            id="scheme-flat"
            inputMode="decimal"
            value={flatOff}
            onChange={(e) => setFlatOff(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheme-minqty">Minimum quantity</Label>
          <Input
            id="scheme-minqty"
            inputMode="numeric"
            value={minQty}
            onChange={(e) => setMinQty(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheme-buyqty">Buy quantity (free goods)</Label>
          <Input
            id="scheme-buyqty"
            inputMode="numeric"
            value={buyQty}
            onChange={(e) => setBuyQty(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheme-freeqty">Free quantity (free goods)</Label>
          <Input
            id="scheme-freeqty"
            inputMode="numeric"
            value={freeQty}
            onChange={(e) => setFreeQty(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheme-combo">Combo product ids (comma-separated)</Label>
          <Input
            id="scheme-combo"
            placeholder="UUID, UUID"
            value={comboProductIds}
            onChange={(e) => setComboProductIds(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheme-from">Valid from (UTC)</Label>
          <Input
            id="scheme-from"
            type="datetime-local"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheme-to">Valid to (UTC)</Label>
          <Input
            id="scheme-to"
            type="datetime-local"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheme-priority">Priority (lower runs first)</Label>
          <Input
            id="scheme-priority"
            inputMode="numeric"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 pt-7 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-4 accent-brand-700"
            checked={stackable}
            onChange={(e) => setStackable(e.target.checked)}
          />
          Stackable with other schemes
        </label>
      </div>

      {error !== null && <p className="text-sm text-danger-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : editing ? 'Save scheme' : 'Create scheme'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
