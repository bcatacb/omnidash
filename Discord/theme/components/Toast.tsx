import * as React from 'react';
import * as RToast from '@radix-ui/react-toast';

export const ToastProvider = RToast.Provider;

export const ToastViewport = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<typeof RToast.Viewport>
>(({ className = '', ...rest }, ref) => (
  <RToast.Viewport
    ref={ref}
    className={
      'fixed bottom-4 right-4 z-50 flex w-96 max-w-[100vw] flex-col gap-2 ' +
      'outline-none ' + className
    }
    {...rest}
  />
));
ToastViewport.displayName = 'ToastViewport';

type ToastVariant = 'default' | 'success' | 'warning' | 'danger';

const variants: Record<ToastVariant, string> = {
  default: 'bg-bg-floating border-bg-tertiary',
  success: 'bg-bg-floating border-green',
  warning: 'bg-bg-floating border-yellow',
  danger:  'bg-bg-floating border-red',
};

export interface ToastProps
  extends React.ComponentPropsWithoutRef<typeof RToast.Root> {
  variant?: ToastVariant;
}

export const Toast = React.forwardRef<HTMLLIElement, ToastProps>(
  ({ variant = 'default', className = '', ...rest }, ref) => (
    <RToast.Root
      ref={ref}
      className={
        `rounded-card border-l-4 p-3 text-text-normal shadow-lg ` +
        `transition-all duration-150 ease-out-discord ` +
        `data-[state=open]:animate-in data-[state=open]:slide-in-from-right ` +
        `data-[state=closed]:animate-out data-[state=closed]:fade-out-0 ` +
        `${variants[variant]} ${className}`
      }
      {...rest}
    />
  ),
);
Toast.displayName = 'Toast';

export const ToastTitle       = RToast.Title;
export const ToastDescription = RToast.Description;
export const ToastAction      = RToast.Action;
export const ToastClose       = RToast.Close;
