'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';

import { callAuthed } from '@/features/auth/api';

/**
 * Staff landing screen.
 *
 * Fetches the profile through `callAuthed`, so an access token that expired between
 * page load and this request is refreshed silently rather than surfacing as an error.
 * The capability list is the useful part for now: it is what the navigation filters on.
 */
export default function AdminDashboardPage() {
  const profile = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => callAuthed((auth) => auth.me()),
  });

  if (profile.isPending) {
    return <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (profile.isError || profile.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load your profile</CardTitle>
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
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Signed in as {user.email ?? user.phone} · {user.status}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your capabilities</CardTitle>
            <CardDescription>
              The navigation shows only the modules these grant. Everything is re-checked on the
              server for every request.
            </CardDescription>
          </CardHeader>
          {user.capabilities.length === 0 ? (
            <p className="text-sm text-slate-500">No capabilities granted.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {user.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-700"
                >
                  {capability}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What comes next</CardTitle>
            <CardDescription>
              Onboarding review, catalogue management, order operations, inventory, credit, invoicing
              and reporting arrive with Phases 1–3. This screen proves the staff session, the API
              client and capability resolution work end to end.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
