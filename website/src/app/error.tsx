'use client';

import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';

/**
 * Route-level error boundary.
 *
 * Next requires this to be a client component. The message intentionally does not
 * render `error.message`: it is a server internal (a stack frame, a database
 * detail) and showing it to a buyer leaks more than it helps. The digest is shown
 * instead, because it is the value that appears in the server log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            The page could not be loaded. Try again — if it keeps failing, quote the reference
            below to support.
          </CardDescription>
        </CardHeader>
        {error.digest !== undefined && (
          <p className="mb-4 font-mono text-xs text-slate-500">Reference: {error.digest}</p>
        )}
        <Button onClick={reset}>Try again</Button>
      </Card>
    </main>
  );
}
