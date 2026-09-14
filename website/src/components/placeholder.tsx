import { Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';

/**
 * A placeholder for a screen that a later phase fills in.
 *
 * Kept out of the route files: Next validates the exports of `page.tsx` and
 * `layout.tsx`, and a stray component export there fails the build.
 */
export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
