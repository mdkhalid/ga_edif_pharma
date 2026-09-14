'use client';

import { Button } from '@medichain/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { logout } from '@/features/auth/api';
import { useAuth } from '@/features/auth/use-auth';

/**
 * The authenticated shell.
 *
 * ## Two layers of protection, one of which matters
 *
 * `middleware.ts` redirects when the refresh cookie is missing, and this component
 * redirects again when the session has resolved to `anonymous` — which is the case
 * the middleware cannot see, because a cookie can be present and its session dead.
 *
 * Neither is access control. The API refuses every protected request on its own, and
 * that is what actually protects the data; this is here so a signed-out user gets a
 * sign-in page instead of a shell full of failed requests.
 *
 * `status === 'unknown'` renders a skeleton rather than redirecting: the session is
 * still being resolved, and redirecting on "unknown" would bounce every reload of a
 * signed-in user to the login page.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status !== 'authenticated' || user === null) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-6 py-16">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-baseline gap-6">
            <Link href="/dashboard" className="text-sm font-semibold tracking-wide text-brand-700">
              MediChain
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/dashboard" className="hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/products" className="hover:text-slate-900">
                Catalogue
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{user.fullName}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void logout().then(() => router.replace('/login'));
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
