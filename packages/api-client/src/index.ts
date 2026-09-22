/**
 * @medichain/api-client
 *
 * The typed client the website, admin portal and mobile app consume. Generated
 * from `backend/openapi.json` — `src/generated/schema.ts` is machine-written and
 * must never be hand-edited.
 *
 * Regenerate after any contract change:
 *
 *   npm run openapi:generate --workspace=@medichain/backend
 *   npm run generate --workspace=@medichain/api-client
 */

export { createApiClient, unwrap, unwrapVoid, type ApiClientOptions, type MediChainClient } from './client';
export { ApiError, toApiError } from './error';

/*
 * One factory per backend module, each a thin typed layer over the generated
 * client.
 *
 * They exist for two things the generated client cannot know. First, the
 * `{ data: … }` success envelope: controllers author it themselves, so it is not
 * in the spec and `unwrap` has to unwrap it. Second, the response body types:
 * the spec models request DTOs only, so response shapes are declared once in
 * `@medichain/shared-types` and both sides of the wire compile against them.
 */

export {
  createAuthApi,
  type AuthApi,
  type LoginRequest,
  type OtpRequestResult,
  type PasswordResetResult,
  type RegisterRequest,
  type RegisterResult,
} from './endpoints/auth';
// Re-export the auth response shapes so consumers do not need a second import
// from `@medichain/shared-types` for the login/MFA contract.
export type {
  LoginResponse,
  MfaChallenge,
  MfaEnabledResult,
  MfaEnrollmentResult,
  MfaSetupResult,
  SignInResult,
  SignInSuccess,
} from '@medichain/shared-types';
export {
  createCatalogApi,
  type CatalogApi,
  type CreateProductRequest,
  type ListProductsOptions,
  type UpdateProductRequest,
} from './endpoints/catalog';
export {
  createSearchApi,
  type SearchApi,
  type SearchProductsOptions,
} from './endpoints/search';
export {
  createCartApi,
  type AddCartItemRequest,
  type CartApi,
} from './endpoints/cart';
export {
  createOrdersApi,
  type ListOrdersOptions,
  type OrdersApi,
  type PlaceOrderRequest,
} from './endpoints/orders';
export {
  createOnboardingApi,
  type OnboardingApi,
  type ReviewApplicationRequest,
  type SubmitApplicationRequest,
} from './endpoints/onboarding';
