'use client';

import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';

/**
 * Route-level error boundary. The message is not rendered — it is a server internal
 * — and the digest is shown instead, because that is the value in the server log.
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
            The page could not be loaded. Try again — if it keeps failing, quote the reference below
            to the platform team.
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
