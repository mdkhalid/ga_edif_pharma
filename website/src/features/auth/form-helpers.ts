import type { ApiError } from '@medichain/api-client';

/**
 * Maps the API's field-level errors onto input names.
 *
 * Shared by every form so an error under an input looks and behaves the same
 * wherever it appears. Ad-hoc per-form mapping is how one screen ends up showing a
 * field error as a page-level banner.
 */
export function fieldErrorsFromApi(error: ApiError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.fieldErrors) {
    result[issue.field] ??= issue.message;
  }
  return result;
}
