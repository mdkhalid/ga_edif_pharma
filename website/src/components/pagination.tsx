import type { OffsetPageMeta } from '@medichain/shared-types';
import { Button } from '@medichain/ui';

/**
 * Offset pagination controls.
 *
 * Renders nothing for an empty result set: "Page 1 of 1" above an empty state is
 * noise that reads like a control the user should be using.
 */
export function Pagination({
  meta,
  onPage,
}: {
  meta: OffsetPageMeta;
  onPage: (page: number) => void;
}) {
  if (meta.total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <span>
        Page {meta.page} of {meta.totalPages} · {meta.total}{' '}
        {meta.total === 1 ? 'product' : 'products'}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!meta.hasPrev}
          onClick={() => {
            onPage(meta.page - 1);
          }}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!meta.hasNext}
          onClick={() => {
            onPage(meta.page + 1);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
