/**
 * The seam between the committed contract and the committed client.
 *
 * CI's authoritative drift check regenerates the client and diffs it (Build
 * job). These tests make the same mismatch visible locally, without git or a
 * backend build: if a route the client uses disappears from the OpenAPI
 * document or from the generated schema, a caller would get an `undefined`
 * response at runtime rather than a compile error.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface OpenApiDocument {
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const document = JSON.parse(
  readFileSync(join(__dirname, '../../../backend/openapi.json'), 'utf8'),
) as OpenApiDocument;
const generated = readFileSync(join(__dirname, '../src/generated/schema.ts'), 'utf8');

const routes: ReadonlyArray<{
  readonly path: string;
  readonly method: 'get' | 'post' | 'patch' | 'delete';
}> = [
  { path: '/catalog/products', method: 'get' },
  { path: '/catalog/products/{id}', method: 'get' },
  { path: '/orders', method: 'get' },
  { path: '/orders', method: 'post' },
  { path: '/invoices', method: 'get' },
  { path: '/invoices/issue', method: 'post' },
  { path: '/invoices/{id}/pdf', method: 'get' },
  { path: '/schemes/{id}', method: 'patch' },
  { path: '/search/products', method: 'get' },
  { path: '/price-lists', method: 'get' },
  { path: '/inventory/stock', method: 'get' },
  { path: '/credit/summary', method: 'get' },
];

describe('committed contract', () => {
  it.each(routes)('documents $method $path', ({ path, method }) => {
    expect(document.paths[path]?.[method]).toBeDefined();
  });

  it.each(routes)('generates a client path for $method $path', ({ path }) => {
    expect(generated).toContain(`"${path}": {`);
  });

  it('documents the PDF endpoint as a binary body, not a JSON envelope', () => {
    const operation = document.paths['/invoices/{id}/pdf']?.['get'] as
      | {
          readonly responses?: Readonly<
            Record<string, { readonly description?: string; readonly content?: unknown }>
          >;
        }
      | undefined;
    const success = operation?.responses?.['200'];

    expect(success?.description).toContain('PDF');
    // There is no content type to parse as JSON — the client must request a Blob.
    expect(success?.content).toBeUndefined();
  });

  it('documents the Idempotency-Key header on issue and placement', () => {
    for (const path of ['/orders', '/invoices/issue']) {
      const operation = document.paths[path]?.['post'] as
        | { readonly parameters?: ReadonlyArray<{ readonly name?: string }> }
        | undefined;
      expect(operation?.parameters?.some((p) => p.name === 'Idempotency-Key')).toBe(true);
    }
  });
});
