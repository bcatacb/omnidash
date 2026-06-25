import { BrandedLoader } from '@/components/ui/spinner'

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <BrandedLoader label="Loading" />
    </div>
  )
}
