import * as React from 'react';
import * as RTabs from '@radix-ui/react-tabs';

export const Tabs = RTabs.Root;

export const TabsList = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof RTabs.List>
>(({ className = '', ...rest }, ref) => (
  <RTabs.List
    ref={ref}
    className={`flex gap-1 border-b border-bg-tertiary ${className}`}
    {...rest}
  />
));
TabsList.displayName = 'TabsList';

const trigger =
  'px-3 py-2 text-sm font-medium text-text-muted ' +
  'border-b-2 border-transparent -mb-px ' +
  'transition-colors duration-100 ease-out-discord ' +
  'hover:text-text-normal ' +
  'data-[state=active]:text-text-normal ' +
  'data-[state=active]:border-brand ' +
  'focus-visible:outline-none focus-visible:text-text-normal';

export const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof RTabs.Trigger>
>(({ className = '', ...rest }, ref) => (
  <RTabs.Trigger ref={ref} className={`${trigger} ${className}`} {...rest} />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof RTabs.Content>
>(({ className = '', ...rest }, ref) => (
  <RTabs.Content
    ref={ref}
    className={`pt-4 text-text-normal focus-visible:outline-none ${className}`}
    {...rest}
  />
));
TabsContent.displayName = 'TabsContent';
