import * as React from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size    = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center font-medium rounded-card ' +
  'transition-colors duration-100 ease-out-discord ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ' +
  'disabled:opacity-50 disabled:pointer-events-none active:duration-150';

const variants: Record<Variant, string> = {
  primary:
    'bg-brand text-white hover:bg-brand-hover',
  secondary:
    'bg-bg-tertiary text-text-normal hover:bg-bg-message-hover',
  danger:
    'bg-red text-white hover:brightness-110',
  ghost:
    'bg-transparent text-text-muted hover:bg-bg-message-hover hover:text-text-normal',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', ...rest }, ref) => (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';
