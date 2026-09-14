import type { InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the input invalid for assistive technology as well as visually. */
  invalid?: boolean;
}

export function Input({ className, invalid = false, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'block h-10 w-full rounded-[var(--radius-control)] bg-white px-3 text-sm text-slate-900',
        'ring-1 ring-inset ring-slate-300 placeholder:text-slate-400',
        'focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand-700',
        'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
        invalid && 'ring-danger-500 focus:outline-danger-500',
        className,
      )}
      {...props}
    />
  );
}
