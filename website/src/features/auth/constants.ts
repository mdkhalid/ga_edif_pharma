/**
 * The password policy, mirrored for the client.
 *
 * Duplicated from `backend/.../password.vo.ts` rather than imported, because the
 * backend value object is server code and pulling it into the browser bundle would
 * ship policy internals for no benefit. The two are allowed to differ in *how*
 * they enforce the rule — the server is authoritative — but not in the numbers, so
 * a mismatch here shows up as a form that accepts a password the API then rejects.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
