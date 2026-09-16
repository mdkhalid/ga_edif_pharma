'use client';

import { Button, Input, Label } from '@medichain/ui';
import { useQuery } from '@tanstack/react-query';
import { splitSaltQuery } from '@medichain/shared-utils';
import { useState, type FormEvent } from 'react';

import { Notice } from '@/components/notice';
import { Pagination } from '@/components/pagination';
import { ProductTable, ProductTableSkeleton } from '@/features/catalog/components/product-table';
import { SALT_PAGE_SIZE, searchBySalt } from '@/features/search/api';

/**
 * Search by salt composition — the platform's distinguishing feature.
 *
 * A buyer asks "which brands contain Paracetamol and Cetirizine", not "show me
 * brand X", so the field takes a combination. The salts echoed back under it come
 * from `splitSaltQuery`, the same parser that built every product's
 * `composition_key`, so what the buyer is shown is what the server will match on.
 */
export function SaltSearchScreen() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');

  const results = useQuery({
    queryKey: ['search', 'products', { query, page }],
    queryFn: () => searchBySalt({ q: query, page, pageSize: SALT_PAGE_SIZE }),
    // Nothing to search for until the buyer submits; firing the first request with
    // an empty `q` would only be a validation error.
    enabled: query !== '',
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setQuery(String(new FormData(event.currentTarget).get('q') ?? '').trim());
    setPage(1);
  }

  const salts = splitSaltQuery(query);
  const result = results.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Search by salt</h1>
        <p className="text-sm text-slate-500">
          Find every product containing a combination of salts, whichever brand it is.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-1">
        <Label htmlFor="salt-query">Salts</Label>
        <div className="flex items-end gap-3">
          <Input
            id="salt-query"
            name="q"
            type="search"
            required
            defaultValue={query}
            maxLength={300}
            placeholder="Paracetamol + Cetirizine"
          />
          <Button type="submit">Search</Button>
        </div>
        {query === '' ? (
          <p className="text-xs text-slate-500">
            Separate salts with <code>+</code>, a comma, or <code>and</code>.
          </p>
        ) : salts.length > 0 ? (
          <p className="text-xs text-slate-500">Matching all of: {salts.join(' + ')}</p>
        ) : (
          <p className="text-xs text-danger-500">Enter at least one salt name.</p>
        )}
      </form>

      {query === '' ? (
        <Notice
          title="Search by composition"
          description="Enter one or more salts, for example “Paracetamol + Cetirizine”. Every product containing all of them is returned, and those whose composition matches exactly are marked."
        />
      ) : results.isError ? (
        <Notice
          title="The search could not be completed"
          description="Your session may have ended, or the API is unavailable. Submitting the search again will retry it."
        />
      ) : result === undefined ? (
        <ProductTableSkeleton />
      ) : result.data.length === 0 ? (
        <Notice
          title="No product contains that combination"
          description="Nothing in the catalogue contains all of those salts. Check the spelling, or search for fewer of them."
        />
      ) : (
        <div className="space-y-4">
          <ProductTable rows={result.data} />
          <Pagination meta={result.meta} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
