import Link from 'next/link';

import { Button, Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>
            That page does not exist, or it belongs to an account you are not signed in to.
          </CardDescription>
        </CardHeader>
        <Link href="/">
          <Button>Back to the home page</Button>
        </Link>
      </Card>
    </main>
  );
}
