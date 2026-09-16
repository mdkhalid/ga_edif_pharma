import type { ProductStatus, ScheduleClass } from '@medichain/shared-types';

import { formatMoney } from '@/lib/format';

/**
 * A row of the shared product table.
 *
 * Deliberately narrower than the two response types that feed it:
 * `ProductSummary` carries a lifecycle status and `SaltSearchResult` carries an
 * `exact` flag, and each is shown only when present.
 */
export interface ProductTableRow {
  readonly id: string;
  readonly name: string;
  readonly schedule: ScheduleClass;
  readonly price: string;
  readonly status?: ProductStatus;
  readonly exact?: boolean;
}

/**
 * The product table, shared by catalogue browse and salt search.
 *
 * A table rather than a card grid: buyers compare prices and schedules down a
 * column, and tabular-nums keeps the decimal points aligned while they do.
 */
export function ProductTable({ rows }: { rows: readonly ProductTableRow[] }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] bg-white ring-1 ring-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Product
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Schedule
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Price
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3">
                <span className="font-medium text-slate-900">{row.name}</span>
                {row.exact === true ? <Badge tone="success">Exact match</Badge> : null}
                {row.status === undefined || row.status === 'ACTIVE' ? null : (
                  <Badge tone="muted">{row.status}</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{row.schedule}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                {formatMoney(row.price)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'success' | 'muted'; children: string }) {
  return (
    <span
      className={
        tone === 'success'
          ? 'ml-2 rounded px-1.5 py-0.5 text-xs font-medium text-success-500 ring-1 ring-success-500'
          : 'ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500'
      }
    >
      {children}
    </span>
  );
}

/**
 * The table's own loading state.
 *
 * A skeleton in the table's shape rather than a spinner, so the page does not jump
 * when the rows arrive.
 */
export function ProductTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] bg-white ring-1 ring-slate-200">
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_unused, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-4">
            <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-12 animate-pulse rounded bg-slate-200" />
            <div className="ml-auto h-4 w-20 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
