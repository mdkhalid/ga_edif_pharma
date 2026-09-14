import type { ApiError } from '@medichain/api-client';

/** Maps the API's field-level errors onto input names. */
export function fieldErrorsFromApi(error: ApiError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.fieldErrors) {
    result[issue.field] ??= issue.message;
  }
  return result;
}
