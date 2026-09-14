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
export {
  createAuthApi,
  type AuthApi,
  type LoginRequest,
  type OtpRequestResult,
  type PasswordResetResult,
  type RegisterRequest,
  type RegisterResult,
} from './endpoints/auth';
