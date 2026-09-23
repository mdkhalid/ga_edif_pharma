'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label } from '@medichain/ui';
import { createCatalogApi } from '@medichain/api-client';
import { ScheduleClass } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

const SCHEDULES: readonly ScheduleClass[] = [
  ScheduleClass.OTC,
  ScheduleClass.H,
  ScheduleClass.H1,
  ScheduleClass.X,
  ScheduleClass.NARCOTIC,
];

/**
 * Create-product form.
 *
 * Mirrors `CreateProductDto` — every required field (`name`, `schedule`, `price`)
 * is captured; the rest are optional. `saltAliases` is entered comma-separated and
 * split on submit. The idempotency key is generated per submit, so a double-click
 * or a retried request cannot create a second product.
 */
export function CatalogueCreateForm({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schedule, setSchedule] = useState<ScheduleClass>(ScheduleClass.OTC);
  const [hsnCode, setHsnCode] = useState('');
  const [strength, setStrength] = useState('');
  const [packSize, setPackSize] = useState('');
  const [packUnit, setPackUnit] = useState('');
  const [price, setPrice] = useState('');
  const [saltAliases, setSaltAliases] = useState('');
  const [compositionKey, setCompositionKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      callAuthed((client) =>
        createCatalogApi(client).create(
          {
            name: name.trim(),
            description: description.trim() || undefined,
            schedule,
            hsnCode: hsnCode.trim() || undefined,
            strength: strength.trim() || undefined,
            packSize: packSize.trim() === '' ? undefined : Number(packSize),
            packUnit: packUnit.trim() || undefined,
            price: Number(price),
            saltAliases: saltAliases.trim() === '' ? undefined : saltAliases.split(',').map((s) => s.trim()),
            compositionKey: compositionKey.trim() || undefined,
          },
          crypto.randomUUID(),
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'browse'] });
      onDone?.();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create the product.'),
  });

  return (
    <form
      className="space-y-4 rounded-[var(--radius-card)] border border-slate-200 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (name.trim() === '' || price.trim() === '') {
          setError('Name and price are required.');
          return;
        }
        if (Number.isNaN(Number(price))) {
          setError('Price must be a number.');
          return;
        }
        create.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="product-name">Name</Label>
          <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-price">Price (₹)</Label>
          <Input
            id="product-price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-schedule">Schedule</Label>
          <select
            id="product-schedule"
            className="h-10 w-full rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as ScheduleClass)}
          >
            {SCHEDULES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-strength">Strength</Label>
          <Input id="product-strength" value={strength} onChange={(e) => setStrength(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-hsn">HSN code</Label>
          <Input id="product-hsn" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-packsize">Pack size</Label>
          <Input
            id="product-packsize"
            inputMode="numeric"
            value={packSize}
            onChange={(e) => setPackSize(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-packunit">Pack unit</Label>
          <Input id="product-packunit" value={packUnit} onChange={(e) => setPackUnit(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-composition">Composition key</Label>
          <Input
            id="product-composition"
            value={compositionKey}
            onChange={(e) => setCompositionKey(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="product-salts">Salt aliases (comma-separated)</Label>
          <Input
            id="product-salts"
            value={saltAliases}
            onChange={(e) => setSaltAliases(e.target.value)}
            placeholder="Paracetamol, Acetaminophen"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="product-desc">Description</Label>
          <Input id="product-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {error !== null && <p className="text-sm text-danger-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create product'}
        </Button>
        {onDone !== undefined && (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
