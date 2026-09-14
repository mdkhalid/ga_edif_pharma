'use client';

import { Capability } from '@medichain/shared-types';
import { Button, cn } from '@medichain/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { logout } from '@/features/auth/api';
import { useAuth } from '@/features/auth/use-auth';
import { usePermission } from '@/features/auth/use-permission';

/**
 * The back-office shell, with role-aware navigation.
 *
 * ## What "RBAC-aware" means here, and what it does not
 *
 * Each nav entry declares the capability it needs. The shell renders only the
 * entries the signed-in user holds, so a finance user does not see an inventory
 * link that would 403 the moment they clicked it.
 *
 * It is **not** access control. Every route is authorised by the API on every
 * request, and a user who types the URL directly is refused server-side. Hiding a
 * link is courtesy; the 403 is the control.
 *
 * Entries are limited to modules that exist. A nav full of links to 404s is worse
 * than a short nav, and Phase 1 fills the rest in.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  /** `null` for entries every authenticated staff member may see. */
  readonly capability: Capability | null;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', capability: null },
  { href: '/onboarding', label: 'Onboarding', capability: Capability.ONBOARDING_READ },
  { href: '/catalog', label: 'Catalogue', capability: Capability.CATALOG_READ },
  { href: '/orders', label: 'Orders', capability: Capability.ORDER_READ },
  { href: '/settings', label: 'Settings', capability: Capability.SETTINGS_READ },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user } = useAuth();
  const { can } = usePermission();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  // `unknown` renders a skeleton rather than redirecting: the session is still being
  // resolved, and bouncing on "unknown" would sign out every reload.
  if (status !== 'authenticated' || user === null) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-6 py-10">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-40 w-full animate-pulse rounded bg-slate-200" />
      </div>
    );
  }

  const visible = NAV_ITEMS.filter((item) => item.capability === null || can(item.capability));

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white px-4 py-5 md:block">
        <p className="px-2 text-sm font-semibold tracking-wide text-brand-700">MediChain Admin</p>
        <nav className="mt-6 space-y-1">
          {visible.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-[var(--radius-control)] px-3 py-2 text-sm',
                  active
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{user.fullName}</p>
            <p className="truncate text-xs text-slate-500">
              {user.roles.join(', ') || 'No role'}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void logout().then(() => router.replace('/login'));
            }}
          >
            Sign out
          </Button>
        </header>

        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
