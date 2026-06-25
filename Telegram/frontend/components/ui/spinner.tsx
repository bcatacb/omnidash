import { Loader2Icon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

function BrandedLoader({
  label = 'Loading',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 text-slate-400', className)}>
      <img src="/logo.png" alt="Telegram Portal" className="h-28 w-auto object-contain" />
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full border-2 border-slate-700" />
        <div className="absolute inset-0 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
      </div>
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}

export { Spinner, BrandedLoader }
