import Link from 'next/link';

import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';

/**
 * Public landing page.
 *
 * A server component: nothing here depends on the session, and rendering it on the
 * server keeps it indexable and fast on first paint. The catalogue pages behind
 * `(public)` follow the same rule.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase">MediChain</p>
        <h1 className="text-4xl font-semibold text-slate-900">
          Order medicines by brand or by salt composition.
        </h1>
        <p className="max-w-2xl text-lg text-slate-600">
          A live catalogue, batch-level availability and your order history — for distributors,
          wholesalers, pharmacies and hospitals.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/register">
            <Button size="lg">Create an account</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary">
              Sign in
            </Button>
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Search by salt</CardTitle>
            <CardDescription>
              Find every brand that contains a given combination, and find it even when the
              spelling is not quite right.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Batch-level stock</CardTitle>
            <CardDescription>
              Availability is tracked per batch with expiry, so what you see is what can be
              dispatched.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Credit and invoices</CardTitle>
            <CardDescription>
              Your credit position, invoices and order history, in one place.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <footer className="mt-auto text-sm text-slate-500">
        Phase 0 skeleton — the catalogue, cart and order screens arrive with Phase 1.
      </footer>
    </main>
  );
}
