import { useState, useMemo } from "react"
import { Loader2, CheckCircle2, AlertTriangle, KeyRound } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

interface BulkCredentialsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

// Accepted formats (one per line):
//   email:password
//   email:password:totpSecret
//   emailpassword          ← no separator, backend prefix-matches by stored email
function parseLines(raw: string): Array<{ email: string; password: string; totpSecret?: string; rawLine: string }> {
  return raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const atIdx = line.indexOf("@")
      if (atIdx < 0) return null

      // Format 1: colon after the @ — email:password[:totp]
      const colonAfterAt = line.indexOf(":", atIdx)
      if (colonAfterAt > 0) {
        const parts = line.split(":")
        const email = parts[0].trim()
        const totpSecret = parts.length > 2 ? parts[parts.length - 1].trim() : undefined
        const password = parts.length > 2
          ? parts.slice(1, parts.length - 1).join(":").trim()
          : parts[1]?.trim() || ""
        if (email && password) return { email, password, totpSecret: totpSecret || undefined, rawLine: line }
      }

      // Format 2: no colon — email glued to password (e.g. user@domain.ruPASSWORD)
      // Use regex to extract email visually for preview; backend prefix-match is the authoritative splitter.
      const m = line.match(/^([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10})(.+)$/)
      if (m) return { email: m[1], password: m[2], rawLine: line }

      // Couldn't split visually — send raw; backend will resolve via prefix match
      return { email: line, password: "", rawLine: line }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null && e.email.includes("@"))
}

export default function BulkCredentialsModal({ open, onOpenChange, onSaved }: BulkCredentialsModalProps) {
  const [raw, setRaw] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<Array<{ email: string; ok: boolean; error?: string }> | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const parsed = useMemo(() => parseLines(raw), [raw])

  const syncEmails = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await fetch("/api/accounts/sync-emails", { method: "POST" })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      if (j.total === 0) {
        setSyncMsg("All accounts already have emails cached.")
      } else {
        setSyncMsg(`Syncing ${j.total} account${j.total === 1 ? "" : "s"} in background (~${j.total}s). Wait a moment then try saving credentials.`)
      }
    } catch (err: any) {
      setSyncMsg(`Sync failed: ${err?.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const submit = async () => {
    if (!parsed.length) return
    setSubmitting(true)
    setResults(null)
    try {
      const r = await fetch("/api/accounts/credentials/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: parsed }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setResults(j.results || [])
      onSaved()
    } catch (err: any) {
      setResults([{ email: "—", ok: false, error: err?.message || "request failed" }])
    } finally {
      setSubmitting(false)
    }
  }

  const saved  = results?.filter((r) => r.ok).length ?? 0
  const failed = results?.filter((r) => !r.ok).length ?? 0

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setRaw(""); setResults(null) } onOpenChange(v) }}>
      <DialogContent className="border-bg-tertiary bg-bg-secondary text-text-normal sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text-normal">
            <KeyRound className="h-4 w-4 text-brand" />
            Bulk save credentials
          </DialogTitle>
          <DialogDescription className="text-text-muted">
            One account per line. Matched by the email already stored on each account.
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <div className="space-y-3 pt-1">
            {/* Sync emails prerequisite */}
            <div className="flex items-center justify-between gap-3 rounded-card border border-bg-tertiary bg-bg-floating px-3 py-2">
              <p className="text-[11px] text-text-muted leading-snug">
                Accounts need an email stored before matching works.
              </p>
              <button
                type="button"
                onClick={syncEmails}
                disabled={syncing}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-chip bg-bg-tertiary px-3 py-1.5 text-[11px] font-semibold text-text-normal hover:bg-bg-message-hover disabled:opacity-60"
              >
                {syncing && <Loader2 className="h-3 w-3 animate-spin" />}
                {syncing ? "Syncing…" : "Sync emails"}
              </button>
            </div>
            {syncMsg && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">{syncMsg}</p>
            )}

            <div className="rounded-card border border-bg-tertiary bg-bg-floating px-3 py-2 text-[11px] text-text-muted space-y-0.5">
              <p className="font-semibold text-text-normal">Format (any of these)</p>
              <p className="font-mono">email:password</p>
              <p className="font-mono">email:password:totpSecret</p>
              <p className="font-mono">emailpassword &nbsp;<span className="text-text-muted/70 not-italic font-sans">← no separator</span></p>
            </div>

            <textarea
              autoFocus
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={"user@gmail.com:hunter2\nother@gmail.com:s3cr3t:JBSWY3DPEHPK3PXP\ndistdiacenar1971@myrambler.ru9KSJHWwWJeqw"}
              spellCheck={false}
              autoComplete="off"
              className="min-h-[160px] w-full rounded-card border border-bg-tertiary bg-bg-tertiary px-3 py-2 font-mono text-xs text-text-normal placeholder:text-text-muted focus:border-brand focus:outline-none"
            />

            <p className="text-[11px] text-text-muted">
              {parsed.length > 0
                ? <span className="text-text-normal font-medium">{parsed.length} account{parsed.length === 1 ? "" : "s"} detected</span>
                : "Paste credentials above to preview"}
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-chip px-3 py-2 text-sm text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || parsed.length === 0}
                className="inline-flex items-center gap-1.5 rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save {parsed.length > 0 ? `${parsed.length} ` : ""}credentials
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-3">
              {saved > 0 && (
                <span className="flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> {saved} saved
                </span>
              )}
              {failed > 0 && (
                <span className="flex items-center gap-1 text-sm font-medium text-red">
                  <AlertTriangle className="h-4 w-4" /> {failed} failed
                </span>
              )}
            </div>

            <ul className="max-h-[200px] space-y-0.5 overflow-y-auto rounded-card border border-bg-tertiary bg-bg-floating px-3 py-2">
              {results.map((r, i) => (
                <li key={i} className={`flex items-center justify-between gap-2 text-[11px] font-mono ${r.ok ? "text-text-muted" : "text-red"}`}>
                  <span className="truncate">{r.ok ? "✓" : "✗"} {r.email}</span>
                  {!r.ok && <span className="shrink-0 text-red/80">{r.error}</span>}
                </li>
              ))}
            </ul>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setRaw(""); setResults(null) }}
                className="rounded-chip px-3 py-2 text-sm text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
              >
                Add more
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
