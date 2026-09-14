/**
 * The error message rendered under a form input.
 *
 * Rendered with `role="alert"` so a screen reader announces it when it appears,
 * and always paired with `aria-describedby` on the input it belongs to.
 */
export function FieldMessage({ id, message }: { id: string; message?: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p id={id} role="alert" className="text-sm text-danger-500">
      {message}
    </p>
  );
}
