import { type Scheme } from '../domain/scheme.types';

/**
 * Scheme (discount) persistence port.
 *
 * Declared in `application/`, implemented in `infra/` (Prisma). The port asks for
 * the schemes relevant to a pricing request — those targeting the order's
 * products/categories, any combo scheme whose products appear, and any order-level
 * scheme — and the engine then decides applicability/eligibility against `asOf`.
 * Keeping the *selection* here (data access) and the *interpretation* in the pure
 * engine means a unit test can bind the token to a stub.
 */
export const SCHEME_REPOSITORY = Symbol('SchemeRepository');

export interface ResolveSchemesInput {
  readonly tenantId: string;
  readonly productIds: readonly string[];
  readonly categoryIds: readonly string[];
  /** The instant at which pricing is evaluated (scheme validity is relative to it). */
  readonly asOf: Date;
}

export interface SchemeRepository {
  resolveSchemes(input: ResolveSchemesInput): Promise<Scheme[]>;
}
