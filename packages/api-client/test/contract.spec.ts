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

interface SchemaNode {
  readonly type?: unknown;
  readonly items?: unknown;
  readonly properties?: unknown;
  readonly additionalProperties?: unknown;
  readonly allOf?: unknown;
  readonly oneOf?: unknown;
  readonly anyOf?: unknown;
  readonly $ref?: unknown;
}

/** A schema is usable if it names a type or points at a definition. */
function hasDefinition(node: SchemaNode, includeType = true): boolean {
  return (
    (includeType && typeof node.type === 'string') ||
    node.properties !== undefined ||
    node.additionalProperties !== undefined ||
    node.allOf !== undefined ||
    node.oneOf !== undefined ||
    node.anyOf !== undefined ||
    node.$ref !== undefined
  );
}

/**
 * `@ApiPropertyOptional` on a union such as `string | null` reflects as
 * `Object`, so Swagger emits `type: object` with no shape and the generated
 * client gets `Record<string, never>` — a field no caller can send. Walk the
 * whole document so a future DTO cannot reintroduce that silently.
 */
function untypedProperties(node: unknown, location: string, found: string[]): string[] {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((child, index) => untypedProperties(child, `${location}[${index}]`, found));
    return found;
  }
  const schema = node as SchemaNode;
  // `type: object` alone is not a shape: every field is then `Record<string, never>`.
  if (schema.type === 'object' && !hasDefinition(schema, false)) {
    found.push(`${location}: object without a shape`);
  }
  if (schema.type === 'array' && !hasDefinition((schema.items ?? {}) as SchemaNode)) {
    found.push(`${location}: array without an item type`);
  }
  for (const [key, child] of Object.entries(node)) {
    untypedProperties(child, `${location}.${key}`, found);
  }
  return found;
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
  { path: '/prescriptions', method: 'get' },
  { path: '/prescriptions/{id}/verify', method: 'post' },
];

describe('committed contract', () => {
  it.each(routes)('documents $method $path', ({ path, method }) => {
    expect(document.paths[path]?.[method]).toBeDefined();
  });

  it.each(routes)('generates a client path for $method $path', ({ path }) => {
    expect(generated).toContain(`"${path}": {`);
  });

  it('gives every documented object and array a usable shape', () => {
    expect(untypedProperties(document, 'openapi', [])).toEqual([]);
  });

  it('does not generate Record<string, never> for a field', () => {
    // The only legitimate empty records are the generator's top-level stubs.
    const offenders = generated
      .split(/\r?\n/)
      .filter((line) => line.includes('Record<string, never>'))
      .filter((line) => !/^export type (webhooks|\$defs) =/.test(line.trim()));
    expect(offenders).toEqual([]);
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
