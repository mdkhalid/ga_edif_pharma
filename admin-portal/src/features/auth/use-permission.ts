'use client';

import type { Capability } from '@medichain/shared-types';

import { useAuthStore } from './store';

/**
 * A stable empty array.
 *
 * The selector below returns this instead of a fresh `[]`. Zustand compares the
 * selector's result with `Object.is`, so returning a new array on every render would
 * make the component re-render forever.
 */
const NO_CAPABILITIES: readonly string[] = Object.freeze([]);

/**
 * Capability checks for the UI.
 *
 * ## This hides buttons; it does not protect anything
 *
 * Every capability is enforced by the API on each request. What this does is stop
 * the portal offering an action that will be refused — a form that always 403s is
 * worse than no form. A staff member who crafts the request directly still gets a
 * 403, which is the actual control.
 *
 * The held capabilities are typed `string[]` because that is what the API returns:
 * a role's capability bundle is data, and a capability added to the server enum but
 * not yet to this client's copy must not break the session. The `Capability` type is
 * used for what the UI *asks for*, where a typo would otherwise silently hide a nav
 * entry.
 */
export function usePermission(): {
  capabilities: readonly string[];
  can: (required: Capability) => boolean;
  canAny: (required: readonly Capability[]) => boolean;
} {
  const capabilities = useAuthStore((state) => state.user?.capabilities ?? NO_CAPABILITIES);
  const held = new Set<string>(capabilities);

  return {
    capabilities,
    can: (required) => held.has(required),
    canAny: (required) => required.some((capability) => held.has(capability)),
  };
}
