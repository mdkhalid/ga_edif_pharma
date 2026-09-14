/** A skeleton that reserves the final layout, so the page does not jump. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-10">
      <div className="h-7 w-56 animate-pulse rounded bg-slate-200" />
      <div className="h-40 w-full animate-pulse rounded-[var(--radius-card)] bg-slate-200" />
    </div>
  );
}
