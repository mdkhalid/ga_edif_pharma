import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'MediChain Admin',
    template: '%s · MediChain Admin',
  },
  description: 'Back-office portal for MediChain staff — onboarding, catalogue, orders and settings.',
  // Staff tooling must never be indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
