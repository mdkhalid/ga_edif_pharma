import type { ReactNode } from 'react';

/**
 * Layout for the authentication screens.
 *
 * A route group, so these pages share a centred, chrome-free layout without
 * inheriting the authenticated shell's guard or navigation. The URL is unaffected
 * by the parentheses.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      {children}
    </main>
  );
}
