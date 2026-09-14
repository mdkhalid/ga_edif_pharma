import type { ReactNode } from 'react';

/** Layout for the staff sign-in screen: centred, with no shell or navigation. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      {children}
    </main>
  );
}
