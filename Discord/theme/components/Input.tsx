import * as React from 'react';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const base =
  'w-full rounded-card bg-bg-tertiary px-3 py-2 text-sm ' +
  'text-text-normal placeholder:text-text-muted ' +
  'border border-transparent ' +
  'transition-colors duration-100 ease-out-discord ' +
  'focus-visible:outline-none focus-visible:border-brand ' +
  'focus-visible:ring-1 focus-visible:ring-brand ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const invalidCls =
  'border-red focus-visible:border-red focus-visible:ring-red';

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ invalid = false, className = '', ...rest }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${base} ${invalid ? invalidCls : ''} ${className}`}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';
