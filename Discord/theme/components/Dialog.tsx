import * as React from 'react';
import * as RDialog from '@radix-ui/react-dialog';

export const Dialog       = RDialog.Root;
export const DialogTrigger = RDialog.Trigger;
export const DialogClose   = RDialog.Close;

const overlay =
  'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm ' +
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0';

const content =
  'fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[92vw] ' +
  '-translate-x-1/2 -translate-y-1/2 ' +
  'rounded-modal bg-bg-floating p-6 shadow-2xl ' +
  'text-text-normal ' +
  'data-[state=open]:animate-in data-[state=open]:zoom-in-95 ' +
  'data-[state=open]:duration-150';

export const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof RDialog.Content>
>(({ className = '', children, ...rest }, ref) => (
  <RDialog.Portal>
    <RDialog.Overlay className={overlay} />
    <RDialog.Content ref={ref} className={`${content} ${className}`} {...rest}>
      {children}
    </RDialog.Content>
  </RDialog.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof RDialog.Title>
>(({ className = '', ...rest }, ref) => (
  <RDialog.Title
    ref={ref}
    className={`text-xl font-semibold text-text-normal ${className}`}
    {...rest}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof RDialog.Description>
>(({ className = '', ...rest }, ref) => (
  <RDialog.Description
    ref={ref}
    className={`mt-2 text-sm text-text-muted ${className}`}
    {...rest}
  />
));
DialogDescription.displayName = 'DialogDescription';
