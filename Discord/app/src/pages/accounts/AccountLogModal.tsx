import { useEffect, useState } from "react"
import { X } from "lucide-react"

interface LogEntry {
  ts: string
  kind: "outreach" | "warmup" | "status"
  ok: boolean
  summary: string
  detail?: string
}

interface Props {
  accountId: string
  accountName: string
  onClose: () => void
}

const KIND_LABEL: Record<LogEntry["kind"], string> = {
  outreach: "Outreach",
  warmup:   "Warmup",
  status:   "Status",
}

const KIND_COLOR: Record<LogEntry["kind"], string> = {
  outreach: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  warmup:   "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  status:   "bg-rose-500/20 text-rose-700 dark:text-rose-300",
}

export default function AccountLogModal({ accountId, accountName, onClose }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/accounts/${accountId}/log`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.entries)) setEntries(d.entries)
        else throw new Error(d?.error || "Failed to load log")
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [accountId])

  const fmt = (ts: string) => {
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      })
    } catch { return ts }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-card border border-bg-tertiary bg-bg-floating shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bg-tertiary px-4 py-3">
          <div>
            <h3 className="text-[14px] font-semibold text-text-normal">Activity log — @{accountName}</h3>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Last 200 events across outreach campaigns and warmup sessions
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-normal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <p className="text-center text-[12px] text-text-muted py-8">Loading…</p>
          )}
          {error && (
            <p className="text-center text-[12px] text-rose-500 py-8">{error}</p>
          )}
          {!loading && !error && entries.length === 0 && (
            <p className="text-center text-[12px] text-text-muted py-8">
              No activity recorded for this account yet.
            </p>
          )}
          {!loading && !error && entries.length > 0 && (
            <ul className="space-y-1">
              {entries.map((e, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-bg-secondary"
                >
                  {/* Dot */}
                  <span
                    className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${e.ok ? "bg-emerald-400" : "bg-rose-400"}`}
                  />
                  {/* Time */}
                  <span className="w-36 shrink-0 text-[11px] tabular-nums text-text-muted">
                    {fmt(e.ts)}
                  </span>
                  {/* Kind chip */}
                  <span
                    className={`shrink-0 rounded-chip px-1.5 py-0.5 text-[10px] font-semibold ${KIND_COLOR[e.kind]}`}
                  >
                    {KIND_LABEL[e.kind]}
                  </span>
                  {/* Summary + detail */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] ${e.ok ? "text-text-normal" : "text-rose-600 dark:text-rose-300 font-medium"}`}>
                      {e.summary}
                    </p>
                    {e.detail && (
                      <p className="mt-0.5 truncate text-[11px] text-text-muted" title={e.detail}>
                        {e.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-bg-tertiary px-4 py-2 text-right">
          <span className="text-[11px] text-text-muted">
            {!loading && !error ? `${entries.length} event${entries.length !== 1 ? "s" : ""}` : ""}
          </span>
        </div>
      </div>
    </div>
  )
}
