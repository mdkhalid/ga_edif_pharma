'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';
import { ApiError, createInvoicesApi } from '@medichain/api-client';
import type { InvoiceStatus } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

const STATUS_TONE: Record<string, string> = {
  ISSUED: 'bg-green-50 text-green-700 ring-green-600/20',
  DRAFT: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  CREDITED: 'bg-blue-50 text-blue-700 ring-blue-600/20',
};

/**
 * Tax-invoice viewer.
 *
 * Reads the invoices the issuing service actually stored: the number, the
 * snapshotted per-line tax and the reconciled totals are all shown as they were
 * issued. No issue or cancel controls live here — both are money-path mutations
 * that belong behind a deliberate separate workflow.
 */
export function InvoicesScreen() {
  const [status, setStatus] = useState<'ALL' | InvoiceStatus>('ALL');
  const [orderId, setOrderId] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ['invoices', 'list', status, orderId, page],
    queryFn: () =>
      callAuthed((client) =>
        createInvoicesApi(client).list({
          status: status === 'ALL' ? undefined : status,
          orderId: orderId === '' ? undefined : orderId,
          page,
          pageSize: 25,
        }),
      ),
  });

  const detail = useQuery({
    queryKey: ['invoices', 'detail', openId],
    enabled: openId !== null,
    queryFn: () => callAuthed((client) => createInvoicesApi(client).getById(openId as string)),
  });

  if (invoices.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (invoices.isError || invoices.data === undefined) {
    const forbidden = invoices.error instanceof ApiError && invoices.error.isForbidden;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load invoices</CardTitle>
          <CardDescription>
            {forbidden
              ? 'Your role needs the invoice:read capability.'
              : 'Signing in again should fix it.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pageData = invoices.data;
  const rows = pageData.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
        <p className="mt-1 text-sm text-slate-500">
          {pageData.meta.total} tax invoices. Numbers are gapless; lines and tax are snapshotted at
          issue time.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setOrderId(String(new FormData(event.currentTarget).get('orderId') ?? '').trim());
          setPage(1);
        }}
      >
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="invoice-status">
            Status
          </label>
          <select
            id="invoice-status"
            className="h-10 rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="ALL">All</option>
            <option value="DRAFT">Draft</option>
            <option value="ISSUED">Issued</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="CREDITED">Credited</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700" htmlFor="invoice-order">
            Order id
          </label>
          <input
            id="invoice-order"
            name="orderId"
            maxLength={64}
            defaultValue={orderId}
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
            <CardTitle>No invoices match</CardTitle>
            <CardDescription>Invoices appear here once an order is issued.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Issued invoices</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Number</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Status</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Issued</th>
                  <th className="p-3 text-right text-sm font-medium text-slate-600">Total</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-slate-100">
                    <td className="p-3 font-mono text-sm text-slate-900">
                      {invoice.invoiceNumber}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          STATUS_TONE[invoice.status] ??
                          'bg-slate-100 text-slate-600 ring-slate-500/20'
                        }`}
                      >
                        {invoice.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-slate-500">
                      {new Date(invoice.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-sm font-medium text-slate-900">
                      ₹{invoice.total}
                    </td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setOpenId(openId === invoice.id ? null : invoice.id)}
                      >
                        {openId === invoice.id ? 'Hide details' : 'Details'}
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
            <CardTitle>Invoice details</CardTitle>
            <CardDescription>
              Tax is recomputed from the per-line snapshotted rates, then reconciled to the paisa.
            </CardDescription>
          </CardHeader>
          {detail.isPending ? (
            <p className="px-6 pb-6 text-sm text-slate-500">Loading details…</p>
          ) : detail.isError || detail.data === undefined ? (
            <p className="px-6 pb-6 text-sm text-danger-600">Could not load this invoice.</p>
          ) : (
            <div className="space-y-6 px-6 pb-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Taxable value</p>
                  <p className="text-sm font-medium text-slate-900">
                    ₹{detail.data.totals.taxableTotal}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Total tax</p>
                  <p className="text-sm font-medium text-slate-900">
                    ₹{detail.data.totals.totalTax}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Round off</p>
                  <p className="text-sm font-medium text-slate-900">
                    ₹{detail.data.totals.roundOff}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Grand total</p>
                  <p className="text-sm font-semibold text-slate-900">
                    ₹{detail.data.totals.grandTotal}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                {detail.data.gstType === 'IGST'
                  ? `Inter-state: IGST ₹${detail.data.totals.igstTotal}`
                  : `Intra-state: CGST ₹${detail.data.totals.cgstTotal} + SGST ₹${detail.data.totals.sgstTotal}`}
              </p>
              {detail.data.lines.length === 0 ? (
                <p className="text-sm text-slate-500">This invoice has no lines.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full rounded border border-slate-200">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="p-3 text-left text-sm font-medium text-slate-600">Product</th>
                        <th className="p-3 text-left text-sm font-medium text-slate-600">HSN</th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">GST</th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">Qty</th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">
                          Taxable
                        </th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">CGST</th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">SGST</th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">IGST</th>
                        <th className="p-3 text-right text-sm font-medium text-slate-600">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.lines.map((line, index) => (
                        <tr key={`${line.productId}-${index}`} className="border-b border-slate-100">
                          <td className="p-3 text-sm text-slate-900">
                            {line.description ?? (
                              <span className="font-mono text-xs text-slate-500">
                                {line.productId}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-sm text-slate-500">{line.hsnCode}</td>
                          <td className="p-3 text-right text-sm text-slate-500">
                            {line.taxRate}%
                          </td>
                          <td className="p-3 text-right text-sm text-slate-500">
                            {line.quantity}
                          </td>
                          <td className="p-3 text-right text-sm text-slate-500">
                            ₹{line.taxableValue}
                          </td>
                          <td className="p-3 text-right text-sm text-slate-500">₹{line.cgst}</td>
                          <td className="p-3 text-right text-sm text-slate-500">₹{line.sgst}</td>
                          <td className="p-3 text-right text-sm text-slate-500">₹{line.igst}</td>
                          <td className="p-3 text-right text-sm font-medium text-slate-900">
                            ₹{line.lineTotal}
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
