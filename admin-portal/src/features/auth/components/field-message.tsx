/** The error message rendered under a form input. */
export function FieldMessage({ id, message }: { id: string; message?: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p id={id} role="alert" className="text-sm text-danger-500">
      {message}
    </p>
  );
}
