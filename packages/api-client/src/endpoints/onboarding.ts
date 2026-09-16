import type {
  OnboardingApplicationSummary,
  OnboardingReviewResult,
  OnboardingSubmissionResult,
} from '@medichain/shared-types';

import { unwrap, type MediChainClient } from '../client';
import type { components } from '../generated/schema';

/**
 * Onboarding and KYC endpoints.
 *
 * Submission is authenticated but not capability-gated: a prospective buyer
 * submits their own organisation. The review queue and the decisions are
 * back-office routes, gated by `onboarding:read` and friends.
 */

export type SubmitApplicationRequest = components['schemas']['SubmitApplicationDto'];
export type ReviewApplicationRequest = components['schemas']['ReviewApplicationDto'];

export interface OnboardingApi {
  /** Requires an `Idempotency-Key`, so a retry cannot create a second organisation. */
  submit(
    body: SubmitApplicationRequest,
    idempotencyKey: string,
  ): Promise<OnboardingSubmissionResult>;
  /** The reviewer queue: organisations awaiting a decision, oldest first. */
  listPending(): Promise<readonly OnboardingApplicationSummary[]>;
  approve(id: string, reason?: string): Promise<OnboardingReviewResult>;
  reject(id: string, reason?: string): Promise<OnboardingReviewResult>;
}

export function createOnboardingApi(client: MediChainClient): OnboardingApi {
  const review = async (
    path: '/onboarding/applications/{id}/approve' | '/onboarding/applications/{id}/reject',
    id: string,
    reason?: string,
  ): Promise<OnboardingReviewResult> =>
    unwrap<OnboardingReviewResult>(
      await client.POST(path, { body: { reason }, params: { path: { id } } }),
    );

  return {
    async submit(body, idempotencyKey) {
      return unwrap<OnboardingSubmissionResult>(
        await client.POST('/onboarding/applications', {
          body,
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
    },

    async listPending() {
      return unwrap<readonly OnboardingApplicationSummary[]>(
        await client.GET('/onboarding/applications', {}),
      );
    },

    approve: (id, reason) => review('/onboarding/applications/{id}/approve', id, reason),
    reject: (id, reason) => review('/onboarding/applications/{id}/reject', id, reason),
  };
}
