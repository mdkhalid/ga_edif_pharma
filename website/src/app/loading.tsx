/**
 * Route-level loading UI.
 *
 * A skeleton rather than a spinner: it reserves roughly the final layout, so the
 * page does not jump when the content arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-16">
      <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-full max-w-xl animate-pulse rounded bg-slate-200" />
    </div>
  );
}
