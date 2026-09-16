'use client';

import { Button, Input, Label } from '@medichain/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Notice } from '@/components/notice';
import { Pagination } from '@/components/pagination';
import { CATALOGUE_PAGE_SIZE, listProducts } from '@/features/catalog/api';
import { ProductTable, ProductTableSkeleton } from '@/features/catalog/components/product-table';

/**
 * Catalogue browse.
 *
 * An authenticated screen rather than a crawlable page, and it has to be: the
 * endpoint requires `catalog:read`, prices are read per organisation and
 * availability is live stock. There is no anonymous catalogue to render — see the
 * note in the route's `page.tsx`.
 */
export function CatalogueScreen() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const products = useQuery({
    queryKey: ['catalog', 'products', { page, search }],
    queryFn: () =>
      listProducts({
        page,
        pageSize: CATALOGUE_PAGE_SIZE,
        ...(search === '' ? {} : { search }),
      }),
  });

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSearch(String(new FormData(event.currentTarget).get('search') ?? '').trim());
    // A new filter is a new result set: holding page 7 of the previous one would
    // show an empty table that reads as "nothing matches".
    setPage(1);
  }

  const result = products.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Catalogue</h1>
        <p className="text-sm text-slate-500">
          Live prices and availability for your organisation.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex items-end gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor="product-search">Search by brand name</Label>
          <Input
            id="product-search"
            name="search"
            type="search"
            defaultValue={search}
            maxLength={200}
            placeholder="Paracetamol"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {products.isError ? (
        <Notice
          title="We could not load the catalogue"
          description="Your session may have ended, or the API is unavailable. Reloading the page will try again."
        />
      ) : result === undefined ? (
        <ProductTableSkeleton />
      ) : result.data.length === 0 ? (
        <Notice
          title="No products found"
          description={
            search === ''
              ? 'The catalogue is empty. Products appear here once they have been created.'
              : `Nothing matches “${search}”. Try a shorter search term.`
          }
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
