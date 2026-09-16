import type { OrgType } from './enums';

/** A distributor application awaiting review. */
export interface OnboardingApplicationSummary {
  readonly id: string;
  readonly legalName: string;
  readonly type: OrgType;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

/** Submission echoes the organisation that was created in `PENDING`. */
export interface OnboardingSubmissionResult {
  readonly id: string;
}

/** Review echoes the organisation whose status changed. */
export interface OnboardingReviewResult {
  readonly id: string;
}
