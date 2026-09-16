'use client';

import { useQuery } from '@tanstack/react-query';
import { createAuthApi } from '@medichain/api-client';
import { Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';
import Link from 'next/link';

import { callAuthed } from '@/features/auth/api';

/**
 * The buyer's landing screen.
 *
 * The profile is fetched through `callAuthed`, which refreshes and retries once on a
 * 401 — so a session that expired between page load and this request recovers
 * silently instead of showing an error the user can do nothing about.
 */
export default function DashboardPage() {
  const profile = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => callAuthed((client) => createAuthApi(client).me()),
  });

  if (profile.isPending) {
    return <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (profile.isError || profile.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>We could not load your profile</CardTitle>
          <CardDescription>
            This usually means the session has ended. Signing in again should fix it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const user = profile.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome, {user.fullName}</h1>
        <p className="text-sm text-slate-500">Signed in as {user.email ?? user.phone}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your account</CardTitle>
            <CardDescription>Status: {user.status}</CardDescription>
          </CardHeader>
          <dl className="space-y-1 text-sm text-slate-600">
            <div className="flex justify-between gap-4">
              <dt>Roles</dt>
              <dd className="font-medium text-slate-900">{user.roles.join(', ') || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Capabilities</dt>
              <dd className="font-medium text-slate-900">{user.capabilities.length}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Start ordering</CardTitle>
            <CardDescription>
              Browse the catalogue for a brand, or search by salt composition when you know what
              the product contains but not what it is called. The cart and order history arrive
              with the rest of Phase 1.
            </CardDescription>
          </CardHeader>
          <div className="flex gap-4 text-sm">
            <Link href="/products" className="font-medium text-brand-700 hover:underline">
              Browse the catalogue
            </Link>
            <Link href="/salt-search" className="font-medium text-brand-700 hover:underline">
              Search by salt
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
