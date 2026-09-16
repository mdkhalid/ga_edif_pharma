import { Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';

/**
 * A card that states what happened, and what to do about it.
 *
 * Used for a list's empty, error and not-yet-available states. Kept out of the route
 * files: Next validates the exports of `page.tsx` and `layout.tsx`, and a stray
 * component export there fails the build.
 */
export function Notice({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
