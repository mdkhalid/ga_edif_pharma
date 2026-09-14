import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

/** Visual weight. `danger` is reserved for destructive, irreversible actions. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 focus-visible:outline-brand-700',
  secondary:
    'bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-900',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-900',
  danger: 'bg-danger-500 text-white hover:brightness-95 focus-visible:outline-danger-500',
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner and blocks interaction. */
  loading?: boolean;
  leadingIcon?: ReactNode;
}

/**
 * The one button.
 *
 * `type` defaults to `"button"`, not the HTML default of `"submit"`. A bare
 * `<button>` inside a form submits it, and in a checkout or cart form that turns a
 * stray click into a real order. Callers that want submission ask for it
 * explicitly.
 */
export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  leadingIcon,
  type = 'button',
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium',
        'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : leadingIcon}
      {children}
    </button>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}
