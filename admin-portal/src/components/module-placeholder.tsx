import { Card, CardDescription, CardHeader, CardTitle } from '@medichain/ui';

/**
 * Placeholder for a back-office module that a later phase fills in.
 *
 * Shows the capability the module is gated on, which is the useful thing to know
 * while the module is unbuilt: if a staff member cannot see the nav entry, the
 * answer is on this page.
 */
export function ModulePlaceholder({
  title,
  capability,
  description,
}: {
  title: string;
  capability: string;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Not built yet</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <p className="text-sm text-slate-500">
          Gated on the <span className="font-mono text-slate-700">{capability}</span> capability.
        </p>
      </Card>
    </div>
  );
}
