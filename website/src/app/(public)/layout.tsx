import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Layout for the public, crawlable pages.
 *
 * Server-rendered by default: buyers search for things like "Paracetamol 500mg
 * supplier" on the open web, so these pages need to be indexable and fast on first
 * paint. The authenticated area is the opposite — a client-side app behind a guard.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/" className="text-sm font-semibold tracking-wide text-brand-700">
            MediChain
          </Link>
          <nav className="flex gap-4 text-sm text-slate-600">
            <Link href="/products" className="hover:text-slate-900">
              Catalogue
            </Link>
            <Link href="/salt-search" className="hover:text-slate-900">
              Search by salt
            </Link>
            <Link href="/login" className="hover:text-slate-900">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
