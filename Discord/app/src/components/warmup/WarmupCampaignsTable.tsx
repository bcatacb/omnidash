import { useEffect, useImperativeHandle, useState, forwardRef } from "react"
import { Link } from "react-router-dom"
import { Flame } from "lucide-react"
import WarmupWizard from "./WarmupWizard"

interface Row { id: string; name: string; status: string; created_at: string; started_at: string | null }

export interface WarmupCampaignsTableHandle {
  openWizard: () => void
}

const WarmupCampaignsTable = forwardRef<WarmupCampaignsTableHandle>((_props, ref) => {
  const [rows, setRows] = useState<Row[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const refresh = () => fetch("/api/warmup-campaigns").then((r) => r.json()).then((j) => setRows(j?.campaigns || [])).catch(() => { /* */ })
  useEffect(() => { refresh(); const t = setInterval(refresh, 10_000); return () => clearInterval(t) }, [])
  useImperativeHandle(ref, () => ({ openWizard: () => setWizardOpen(true) }), [])
  return (
    <section className="rounded-card border border-bg-tertiary bg-bg-secondary">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Flame className="h-4 w-4 text-amber-500" /> Warmup campaigns</h2>
      </div>
      <table className="w-full text-[12px]">
        <thead className="text-text-muted">
          <tr><th className="text-left px-4 py-1.5">Name</th><th className="text-left">Status</th><th className="text-left">Started</th><th></th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="text-center text-text-muted py-4">No warmup campaigns yet. Use “+ New campaign” at the top → Warmup.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-bg-tertiary">
              <td className="px-4 py-1.5 font-mono">{r.name}</td>
              <td><span className="rounded-chip bg-bg-tertiary px-2 py-0.5">{r.status}</span></td>
              <td>{r.started_at ? new Date(r.started_at).toLocaleString() : "—"}</td>
              <td className="text-right pr-4"><Link to={`/app/campaigns/warmup/${r.id}`} className="text-brand hover:underline">Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      {wizardOpen && <WarmupWizard onClose={() => setWizardOpen(false)} onCreated={(id) => { setWizardOpen(false); refresh(); void id }} />}
    </section>
  )
})
WarmupCampaignsTable.displayName = "WarmupCampaignsTable"
export default WarmupCampaignsTable
