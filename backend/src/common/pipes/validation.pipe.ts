import { BadRequestException, ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';

/**
 * The single place the boundary validation policy is stated.
 *
 * Applied globally in `main.ts` so no controller can forget it.
 *
 * ## Why each option
 *
 * - `whitelist: true` — strips properties with no decorator. Without it, a
 *   client can post `{ "role": "SUPER_ADMIN" }` to a profile-update endpoint and
 *   have the extra field reach a spread-based update.
 * - `forbidNonWhitelisted: true` — rejects rather than silently strips, so a
 *   client sending a wrong field name gets a 400 instead of wondering why its
 *   value had no effect.
 * - `transform: true` — instantiates the DTO class, which is what makes
 *   `@Type(() => Number)` conversions work. Without it, `pageSize` arrives as
 *   the string `"25"` and every comparison against a number is quietly wrong.
 * - `transformOptions.enableImplicitConversion: false` — implicit conversion
 *   coerces `"abc"` to `NaN` and then passes, because `NaN` is a number. Only
 *   fields with an explicit `@Type()` are converted.
 * - `validationError: { target: false, value: false }` — never echo the
 *   rejected input back. It frequently contains a password.
 * - `stopAtFirstError: false` — report every field problem at once, so a form
 *   shows all its errors in one round trip instead of one per submit.
 * - `forbidUnknownValues: true` — a payload that matches no DTO is rejected.
 */
export function createValidationPipe(overrides: ValidationPipeOptions = {}): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
      exposeDefaultValues: true,
    },
    validationError: { target: false, value: false },
    stopAtFirstError: false,
    exceptionFactory: (errors) => {
      // Flatten the tree so a nested field reads `address.city`, not a nested
      // object the client has to walk. The shape matches `FieldError` in
      // @medichain/shared-types, which the exception filter passes through.
      const fields = flattenValidationErrors(errors);
      return new BadRequestException({
        message: 'Request validation failed.',
        errors: fields,
      });
    },
    ...overrides,
  });
}

interface RawValidationError {
  property: string;
  constraints?: Record<string, string>;
  children?: RawValidationError[];
}

/** Flattens nested `ValidationError`s into `a.b.c` field paths. */
export function flattenValidationErrors(
  errors: readonly RawValidationError[],
  parentPath = '',
): Array<{ field: string; code: string; message: string }> {
  const flat: Array<{ field: string; code: string; message: string }> = [];

  for (const error of errors) {
    const path = parentPath === '' ? error.property : `${parentPath}.${error.property}`;

    for (const [code, message] of Object.entries(error.constraints ?? {})) {
      flat.push({ field: path, code, message });
    }

    if (error.children !== undefined && error.children.length > 0) {
      flat.push(...flattenValidationErrors(error.children, path));
    }
  }

  return flat;
}
