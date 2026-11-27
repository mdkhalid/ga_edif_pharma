/**
 * Contract tests at the endpoint seam: the shape of the request that goes on
 * the wire and the shape of the response that reaches the screen.
 *
 * These use the real `openapi-fetch` client with an injected fetch, so path
 * substitution, query serialisation, headers and body parsing behave exactly as
 * they do in the website, admin portal and mobile app.
 */
import {
  createCatalogApi,
  createCreditApi,
  createInvoicesApi,
  createOrdersApi,
  createPaymentsApi,
  createPriceListsApi,
  createPrescriptionsApi,
  createSchemesApi,
  createSearchApi,
  createStockApi,
  ApiError,
  type MediChainClient,
} from '../src';

import {
  createHarness,
  jsonResponse,
  pageBody,
  PAGE_META,
  problemResponse,
} from './support/fetch';

interface PageLike {
  readonly data: readonly unknown[];
  readonly meta: unknown;
}

const pagedRoutes: ReadonlyArray<{
  readonly name: string;
  readonly path: string;
  readonly list: (client: MediChainClient) => Promise<PageLike>;
}> = [
  { name: 'catalog.list', path: '/api/v1/catalog/products', list: (c) => createCatalogApi(c).list() },
  { name: 'orders.list', path: '/api/v1/orders', list: (c) => createOrdersApi(c).list() },
  { name: 'invoices.list', path: '/api/v1/invoices', list: (c) => createInvoicesApi(c).list() },
  { name: 'schemes.list', path: '/api/v1/schemes', list: (c) => createSchemesApi(c).list() },
  {
    name: 'search.products',
    path: '/api/v1/search/products',
    list: (c) => createSearchApi(c).products({ q: 'Paracetamol' }),
  },
  { name: 'priceLists.list', path: '/api/v1/price-lists', list: (c) => createPriceListsApi(c).list() },
  { name: 'stock.list', path: '/api/v1/inventory/stock', list: (c) => createStockApi(c).list() },
  { name: 'credit.list', path: '/api/v1/credit/summary', list: (c) => createCreditApi(c).list() },
  {
    name: 'prescriptions.list',
    path: '/api/v1/prescriptions',
    list: (c) => createPrescriptionsApi(c).list(),
  },
  {
    name: 'payments.list',
    path: '/api/v1/payments',
    list: (c) => createPaymentsApi(c).list(),
  },
];

describe('paged endpoints', () => {
  it.each(pagedRoutes)('$name keeps meta and reads $path', async ({ path, list }) => {
    const harness = createHarness(() => jsonResponse(pageBody()));
    const page = await list(harness.client);

    expect(page.data).toEqual([{ id: 'row-1' }]);
    expect(page.meta).toEqual(PAGE_META);
    expect(harness.requests[0]?.method).toBe('GET');
    expect(harness.requests[0]?.url.pathname).toBe(path);
  });

  it('serialises page options into the query string', async () => {
    const harness = createHarness(() => jsonResponse(pageBody()));
    await createCatalogApi(harness.client).list({
      page: 2,
      pageSize: 1,
      search: 'dolo',
      schedule: 'OTC',
    });

    const url = harness.requests[0]?.url;
    expect(url?.searchParams.get('page')).toBe('2');
    expect(url?.searchParams.get('pageSize')).toBe('1');
    expect(url?.searchParams.get('search')).toBe('dolo');
    expect(url?.searchParams.get('schedule')).toBe('OTC');
  });
});

describe('single-resource endpoints', () => {
  it('substitutes path parameters and unwraps the envelope', async () => {
    const harness = createHarness(() => jsonResponse({ data: { id: 'p-1', name: 'Dolo 650mg' } }));
    const product = await createCatalogApi(harness.client).getById('p-1');

    expect(product).toEqual({ id: 'p-1', name: 'Dolo 650mg' });
    expect(harness.requests[0]?.url.pathname).toBe('/api/v1/catalog/products/p-1');
  });

  it('sends the Idempotency-Key on every unsafe mutation that requires one', async () => {
    const mutations: ReadonlyArray<{
      readonly name: string;
      readonly path: string;
      readonly call: (client: MediChainClient) => Promise<unknown>;
    }> = [
      {
        name: 'catalog.create',
        path: '/api/v1/catalog/products',
        call: (c) => createCatalogApi(c).create({ name: 'Dolo', schedule: 'OTC', price: 10 }, 'idem-c'),
      },
      {
        name: 'orders.place',
        path: '/api/v1/orders',
        call: (c) => createOrdersApi(c).place({}, 'idem-o'),
      },
      {
        name: 'invoices.issue',
        path: '/api/v1/invoices/issue',
        call: (c) => createInvoicesApi(c).issue({ orderId: 'o-1', roundToWholeRupee: true }, 'idem-i'),
      },
      {
        name: 'payments.createIntent',
        path: '/api/v1/payments/intents',
        call: (c) => createPaymentsApi(c).createIntent({ orderId: 'o-1' }, 'idem-p'),
      },
    ];

    for (const mutation of mutations) {
      const harness = createHarness(() => jsonResponse({ data: { id: 'created' } }));
      await mutation.call(harness.client);

      const request = harness.requests[0];
      expect(request?.method).toBe('POST');
      expect(request?.url.pathname).toBe(mutation.path);
      expect(request?.headers.get('idempotency-key')).toMatch(/^idem-[coip]$/);
    }
  });

  it('maps a 404 problem to ApiError, not a blank screen', async () => {
    const problem = problemResponse({
      type: 'https://errors.medichain.test/problems/not_found',
      title: 'Not found',
      status: 404,
      detail: 'No such invoice.',
    });
    const harness = createHarness(() => problem.clone());

    const error = await createInvoicesApi(harness.client)
      .getById('missing')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_FOUND');
  });
});

describe('prescriptions.verify', () => {
  it('posts the decision to the right path and unwraps the id', async () => {
    const harness = createHarness(() => jsonResponse({ data: { id: 'rx-1' } }));
    const result = await createPrescriptionsApi(harness.client).verify('rx-1', {
      decision: 'REJECT',
      reason: 'Illegible handwriting',
    });

    expect(result).toEqual({ id: 'rx-1' });
    expect(harness.requests[0]?.method).toBe('POST');
    expect(harness.requests[0]?.url.pathname).toBe('/api/v1/prescriptions/rx-1/verify');
    expect(JSON.parse(harness.requests[0]?.body ?? '{}')).toMatchObject({
      decision: 'REJECT',
      reason: 'Illegible handwriting',
    });
  });
});

describe('payments', () => {
  it('sends the signature and provider headers and reads the raw webhook acknowledgement', async () => {
    const harness = createHarness(() =>
      jsonResponse({ received: true, duplicate: true }),
    );

    const result = await createPaymentsApi(harness.client).submitWebhook(
      { eventId: 'evt_1', paymentId: 'p-1', type: 'CAPTURED' },
      'signed',
      'mock',
    );

    expect(result).toEqual({ received: true, duplicate: true });
    const request = harness.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url.pathname).toBe('/api/v1/payments/webhooks');
    expect(request?.headers.get('x-payment-signature')).toBe('signed');
    expect(request?.headers.get('x-payment-provider')).toBe('mock');
    // The webhook route is @RawResponse(): there is no `{ data }` envelope to unwrap.
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      eventId: 'evt_1',
      paymentId: 'p-1',
      type: 'CAPTURED',
    });
  });

  it('unwraps a payment summary and substitutes the path id', async () => {
    const harness = createHarness(() =>
      jsonResponse({ data: { id: 'pay-1', amount: '236.00', status: 'CAPTURED' } }),
    );

    const payment = await createPaymentsApi(harness.client).getById('pay-1');

    expect(payment).toEqual({ id: 'pay-1', amount: '236.00', status: 'CAPTURED' });
    expect(harness.requests[0]?.url.pathname).toBe('/api/v1/payments/pay-1');
  });
});

describe('invoices.downloadPdf', () => {
  const pdfBytes = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF';

  it('returns the response as a Blob, with bytes intact', async () => {
    const pdf = new Blob([pdfBytes], { type: 'application/pdf' });
    const harness = createHarness(
      () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );

    const result = await createInvoicesApi(harness.client).downloadPdf('inv-1');

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('application/pdf');
    expect(await result.text()).toBe(pdfBytes);
    expect(harness.requests[0]?.method).toBe('GET');
    expect(harness.requests[0]?.url.pathname).toBe('/api/v1/invoices/inv-1/pdf');
  });

  it('throws ApiError for a failed download rather than returning an error body as a PDF', async () => {
    const harness = createHarness(() =>
      problemResponse({
        type: 'https://errors.medichain.test/problems/not_found',
        title: 'Not found',
        status: 404,
        detail: 'No such invoice.',
      }),
    );

    const error = await createInvoicesApi(harness.client)
      .downloadPdf('missing')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).code).toBe('NOT_FOUND');
  });
});
