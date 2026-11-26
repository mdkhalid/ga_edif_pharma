import type {
  PrescriptionPage,
  PrescriptionSummary,
  PrescriptionVerificationResult,
} from '@medichain/shared-types';

import { unwrap, unwrapPage, type MediChainClient } from '../client';
import type { components } from '../generated/schema';

/**
 * Prescription endpoints for the pharmacist queue.
 *
 * Response shapes come from `@medichain/shared-types`, not the generated spec:
 * controllers author their own `{ data }` envelope, so openapi-fetch sees an
 * untyped success body. Request bodies *are* in the contract and are generated.
 */
export type CreatePrescriptionRequest = components['schemas']['CreatePrescriptionDto'];
export type VerifyPrescriptionRequest = components['schemas']['VerifyPrescriptionDto'];

export interface ListPrescriptionsOptions {
  /** Staff only: filter the queue to one buying organisation. */
  readonly organisationId?: string;
  readonly status?: PrescriptionSummary['status'];
  readonly page?: number;
  readonly pageSize?: number;
}

export interface PrescriptionsApi {
  /** Own organisation for buyers, the whole tenant queue for staff. */
  list(options?: ListPrescriptionsOptions): Promise<PrescriptionPage>;
  getById(id: string): Promise<PrescriptionSummary>;
  create(body: CreatePrescriptionRequest): Promise<{ id: string }>;
  /** Approve or reject. A rejection must carry a reason. */
  verify(id: string, body: VerifyPrescriptionRequest): Promise<PrescriptionVerificationResult>;
}

export function createPrescriptionsApi(client: MediChainClient): PrescriptionsApi {
  return {
    async list(options = {}) {
      return unwrapPage<PrescriptionPage>(
        await client.GET('/prescriptions', { params: { query: options } }),
      );
    },

    async getById(id) {
      return unwrap<PrescriptionSummary>(
        await client.GET('/prescriptions/{id}', { params: { path: { id } } }),
      );
    },

    async create(body) {
      return unwrap<{ id: string }>(await client.POST('/prescriptions', { body }));
    },

    async verify(id, body) {
      return unwrap<PrescriptionVerificationResult>(
        await client.POST('/prescriptions/{id}/verify', {
          body,
          params: { path: { id } },
        }),
      );
    },
  };
}
