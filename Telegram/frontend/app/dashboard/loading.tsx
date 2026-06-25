import { BrandedLoader } from '@/components/ui/spinner'

export default function DashboardLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <BrandedLoader label="Loading dashboard" />
    </div>
  )
}
