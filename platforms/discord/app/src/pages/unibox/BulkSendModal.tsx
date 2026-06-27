import { useEffect, useRef, useState } from "react"
import { BookOpen, ChevronDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"

const DEFAULT_VARIANTS: string[] = [
  "Hey have you been playing at all lately?",
  "Hey my man are you looking to make a little extra bread?",
  "Hey you play GG? Got you with some solid spots and deals",
  "Yo, not sure if you play on GG but in the big unions the Bots are pretty crazy. So now we got some private spots I run security on. You got to check it out! I'll throw you some free chips also",
]

interface PerAccount { accountId: string; accountUsername: string; sent: number; failed: number }
interface BulkResult { sent: number; failed: number; perAccount: PerAccount[]; failures: { conversationId: string; error: string }[] }
interface SavedTemplate { id: string; name: string | null; body: string }

export default function BulkSendModal({
  conversationIds, conversationCount, filterLabel, onClose,
}: {
  conversationIds: string[]
  conversationCount: number
  filterLabel: string
  onClose: () => void
}) {
  const [variants, setVariants] = useState<string[]>(DEFAULT_VARIANTS)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [spacingMs, setSpacingMs] = useState(3000)
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([])
  const [showSavedPicker, setShowSavedPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/templates").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setSavedTemplates(data)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!showSavedPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowSavedPicker(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showSavedPicker])

  const cleanedVariants = variants.map((t) => t.trim()).filter((t) => t.length > 0)
  const canSend = !sending && conversationIds.length > 0 && cleanedVariants.length > 0
  const etaSeconds = Math.ceil((conversationIds.length * spacingMs) / 1000)

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      const r = await fetch("/api/unibox/bulk-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationIds, templates: cleanedVariants, spacingMs }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setResult({
        sent: j.sent || 0,
        failed: j.failed || 0,
        perAccount: Array.isArray(j.perAccount) ? j.perAccount : [],
        failures: Array.isArray(j.failures) ? j.failures : [],
      })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-card border border-bg-tertiary bg-bg-floating p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Send template to conversations</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Picks a random variant per conversation, renders <code className="rounded bg-muted px-1">{"{{firstName}}"}</code> against the peer's name.
              Sequential, 500ms between sends. Does NOT respect the campaign 6/day cap — operator-owned blast.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 rounded-md border border-input bg-muted/30 p-3 text-[12px] space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Recipients</span>
            <span className="font-semibold text-foreground">{conversationCount} conversation{conversationCount === 1 ? "" : "s"}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">{filterLabel}</div>
          <div className="flex items-center justify-between gap-3 border-t border-input/60 pt-2">
            <label className="text-muted-foreground" htmlFor="bulk-spacing">Between sends</label>
            <div className="flex items-center gap-2">
              <input
                id="bulk-spacing"
                type="range"
                min={500}
                max={30000}
                step={500}
                value={spacingMs}
                onChange={(e) => setSpacingMs(Number(e.target.value))}
                disabled={sending}
                className="w-32"
              />
              <span className="w-16 text-right font-semibold tabular-nums text-foreground">
                {spacingMs < 1000 ? `${spacingMs}ms` : `${(spacingMs / 1000).toFixed(spacingMs % 1000 === 0 ? 0 : 1)}s`}
              </span>
            </div>
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>ETA</span>
            <span className="font-semibold tabular-nums text-foreground">~{etaSeconds < 60 ? `${etaSeconds}s` : `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`}</span>
          </div>
        </div>

        {!result && (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium">Variants ({cleanedVariants.length})</span>
              <div className="flex items-center gap-3">
                <div className="relative" ref={pickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowSavedPicker((v) => !v)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <BookOpen className="h-3 w-3" />
                    Saved{savedTemplates.length > 0 ? ` (${savedTemplates.length})` : ""}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showSavedPicker && (
                    <div className="absolute right-0 top-6 z-20 w-80 rounded-md border border-input bg-bg-floating shadow-xl">
                      {savedTemplates.length === 0 ? (
                        <div className="px-3 py-3 text-[11px] text-muted-foreground">No saved templates yet.</div>
                      ) : (
                        <ul className="max-h-60 overflow-y-auto py-1">
                          {savedTemplates.map((t) => (
                            <li key={t.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setVariants((prev) => [...prev, t.body])
                                  setShowSavedPicker(false)
                                }}
                                className="w-full px-3 py-2 text-left hover:bg-muted"
                              >
                                {t.name && <div className="text-[12px] font-medium text-foreground">{t.name}</div>}
                                <div className="text-[11px] text-muted-foreground line-clamp-2">{t.body}</div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setVariants((v) => [...v, ""])}
                  className="text-[11px] text-brand hover:underline"
                >
                  + Add variant
                </button>
              </div>
            </div>
            <div className="mb-3 space-y-2 max-h-[40vh] overflow-y-auto">
              {variants.map((v, i) => (
                <div key={i} className="flex items-start gap-2">
                  <textarea
                    value={v}
                    onChange={(e) => setVariants((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))}
                    rows={2}
                    className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-[12px] resize-y"
                    placeholder={`Variant ${i + 1}`}
                  />
                  {variants.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setVariants((prev) => prev.filter((_, j) => j !== i))}
                      className="mt-1 text-[11px] text-muted-foreground hover:text-rose-500"
                    >
                      remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {error && (
              <div className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-200">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={sending}>Cancel</Button>
              <Button onClick={send} disabled={!canSend}>
                {sending ? `Sending… ${conversationIds.length} convs` : `Send to ${conversationIds.length}`}
              </Button>
            </div>
          </>
        )}

        {result && (
          <div className="space-y-3 text-[12px]">
            <div className="rounded-md border border-input bg-muted/30 p-3">
              <div className="font-semibold text-foreground">
                Done — {result.sent} sent
                {result.failed > 0 && <> · <span className="text-rose-600 dark:text-rose-300">{result.failed} failed</span></>}
              </div>
              {result.perAccount.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {result.perAccount.map((a) => (
                    <li key={a.accountId}>
                      <code className="rounded bg-muted px-1 text-[11px]">@{a.accountUsername}</code>
                      {" "}— {a.sent} sent
                      {a.failed > 0 && <span className="text-rose-500"> · {a.failed} failed</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {result.failures.length > 0 && (
              <details className="rounded-md border border-input bg-background p-3">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  {result.failures.length} failure{result.failures.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto font-mono text-[10px] text-muted-foreground">
                  {result.failures.slice(0, 50).map((f) => (
                    <li key={f.conversationId} className="truncate">
                      {f.conversationId.slice(0, 18)}… — {f.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
