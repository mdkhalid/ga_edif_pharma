import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution.
 *
 * `twMerge` matters when a component takes a `className` override: without it,
 * `cn('p-4', 'p-2')` emits both and the winner depends on stylesheet order, not on
 * the caller's intent. With it, the later value wins — which is what every caller
 * already assumes.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
