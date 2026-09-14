import { Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>
            That screen does not exist, or your role does not have access to it.
          </CardDescription>
        </CardHeader>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
          Back to the dashboard
        </Link>
      </Card>
    </main>
  );
}
