import { useEffect, useMemo, useRef, useState } from "react"
function uid(): string {
  try { return crypto.randomUUID() } catch { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }
}
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Rocket, Trash2 } from "lucide-react"
import {
  type Campaign,
  type DiscordAccount,
  type NewCampaignRequest,
} from "@/api-types"

interface SavedTemplate { id: string; name: string | null; body: string }

interface NewCampaignWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (campaign: Campaign) => void
}

type ParsedLead = { discordUserId: string; displayName?: string; eligibleAccountIds?: string[] }

function relativeTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime()
    const s = Math.floor(ms / 1000)
    if (s < 60) return "just now"
    const m = Math.floor(s / 60)
    if (m < 60) return `${m} min ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  } catch { return iso }
}

const STEPS = ["Name", "Accounts & Servers", "Scrape & start"] as const
type StepIndex = 0 | 1 | 2

type ScrapePair = {
  id: string
  accountId: string
  guildId: string
  guildName?: string
  approximateMemberCount?: number | null
  saved: boolean        // pair has been confirmed/saved by user
  membersFound?: number // populated after running
  via?: "op8" | "op14" | "cache"
  cached?: boolean
  scrapedAt?: string
}
type GuildOption = { id: string; name: string; iconUrl: string | null; approximateMemberCount: number | null }

// ───── Draft persistence (localStorage) ─────────────────────────────────────
// Bumped to v2 — schema is incompatible with v1 (no leadsText / leadSource).
const DRAFT_KEY = "discord-unibox:campaign-wizard-draft:v2"
const DRAFT_KEY_LEGACY = "discord-unibox:campaign-wizard-draft:v1"
interface WizardDraft {
  step?: StepIndex
  name?: string
  templates?: string[]
  perDay?: number
  minInterSendSeconds?: number
  minGlobalSpacingSeconds?: number
  scrapePairs?: ScrapePair[]
  savedAt?: string
}

function loadDraftFromStorage(): WizardDraft | null {
  if (typeof window === "undefined") return null
  // Drop any legacy v1 draft so it doesn't confuse the v2 picker.
  try { localStorage.removeItem(DRAFT_KEY_LEGACY) } catch { /* noop */ }
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as WizardDraft
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch {
    return null
  }
}

function saveDraftToStorage(d: WizardDraft) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: new Date().toISOString() }))
  } catch { /* quota; ignore */ }
}

function clearDraftFromStorage() {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* noop */ }
}


export default function NewCampaignWizard({ open, onOpenChange, onCreated }: NewCampaignWizardProps) {
  const [step, setStep] = useState<StepIndex>(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Step 0 — Basics
  const [name, setName] = useState("")
  const [templates, setTemplates] = useState<string[]>([""])
  const [perDay, setPerDay] = useState(20)
  // Per-account cooldown — how long before the SAME account can send again.
  const [minInterSendSeconds, setMinInterSendSeconds] = useState(480) // 8 min default
  // Global spacing — minimum gap between ANY two sends in the campaign (different accounts).
  const [minGlobalSpacingSeconds, setMinGlobalSpacingSeconds] = useState(300) // 5 min default

  // Step 1 — Account+Server pairs (the only place we pick accounts)
  const [accounts, setAccounts] = useState<DiscordAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [scrapePairs, setScrapePairs] = useState<ScrapePair[]>([
    { id: uid(), accountId: "", guildId: "", saved: false },
  ])
  const [scrapeGuildsByAccount, setScrapeGuildsByAccount] = useState<
    Record<string, GuildOption[]>
  >({})
  const [scrapeRunning, setScrapeRunning] = useState(false)
  const [scrapeError, setScrapeError] = useState<string | null>(null)

  // Step 2 — Review / scrape results
  // v0.54 — explicit "leads per account" knob so the operator decides the
  // exact quota per account before submit. Drives leadStart/leadEnd so the
  // total queued = leadsPerAccount × accounts. Default 5 (matches a safe
  // first-run pace for warm DMs).
  const [leadsPerAccount, setLeadsPerAccount] = useState<number>(5)
  const [scrapedLeads, setScrapedLeads] = useState<ParsedLead[]>([])
  const [scrapeSummary, setScrapeSummary] = useState<{ totalMembers: number; uniqueMembers: number; anyFromCache?: boolean; excludedAlreadyContacted?: number } | null>(null)
  // How many of the scraped leads to actually use in the campaign. Defaults
  // to "all" but the user can dial it down with a slider — useful for keeping
  // first runs small (say 5–10 leads) to avoid tripping Discord's anti-spam.
  // Range slider state — 1-indexed inclusive bounds. `null` until first scrape lands.
  const [leadStart, setLeadStart] = useState<number | null>(null)
  const [leadEnd, setLeadEnd] = useState<number | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [draftSavedToast, setDraftSavedToast] = useState(false)

  // Saved template library (from backend)
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([])
  const [showSavedPicker, setShowSavedPicker] = useState(false)
  const [savedTemplateToast, setSavedTemplateToast] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Reset when dialog opens
  useEffect(() => {
    if (!open) return
    setSubmitting(false)
    setSubmitError(null)
    const restored = loadDraftFromStorage()
    if (restored) {
      setName(restored.name ?? "")
      setTemplates(restored.templates?.length ? restored.templates : [""])
      setPerDay(restored.perDay ?? 20)
      setMinInterSendSeconds(restored.minInterSendSeconds ?? 1800)
      setMinGlobalSpacingSeconds(restored.minGlobalSpacingSeconds ?? 300)
      setScrapePairs(
        restored.scrapePairs?.length
          ? restored.scrapePairs
          : [{ id: uid(), accountId: "", guildId: "", saved: false }],
      )
      setStep(restored.step ?? 0)
      setDraftRestored(true)
    } else {
      setName("")
      setTemplates([""])
      setPerDay(20)
      setMinInterSendSeconds(0)
      setScrapePairs([{ id: uid(), accountId: "", guildId: "", saved: false }])
      setStep(0)
      setDraftRestored(false)
    }
    setScrapeGuildsByAccount({})
    setScrapeRunning(false)
    setScrapeError(null)
    setScrapedLeads([])
    setScrapeSummary(null)
    setLeadStart(null)
    setLeadEnd(null)
    setShowSavedPicker(false)
    fetch("/api/templates").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) {
        setSavedTemplates(data)
        // Fresh open (no draft) — populate active templates from saved templates
        if (!restored) {
          const bodies = (data as SavedTemplate[]).map((t) => t.body).filter(Boolean)
          setTemplates(bodies.length > 0 ? bodies : [""])
        }
      }
    }).catch(() => {})
  }, [open])

  // Auto-save draft on every form change
  useEffect(() => {
    if (!open) return
    const hasContent =
      name.trim().length > 0 ||
      templates.some((t) => t.trim().length > 0) ||
      scrapePairs.some((p) => p.accountId || p.guildId)
    if (!hasContent) return
    saveDraftToStorage({
      step, name, templates, perDay, minInterSendSeconds, minGlobalSpacingSeconds, scrapePairs,
    })
  }, [open, step, name, templates, perDay, minInterSendSeconds, scrapePairs])

  // Close the saved-templates picker when clicking outside of it.
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

  // Fetch the account list once when the dialog opens (used to label scrape pairs).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const fetchAccounts = async () => {
      setAccountsLoading(true)
      setAccountsError(null)
      try {
        const res = await fetch("/api/accounts")
        if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`)
        const data: DiscordAccount[] = await res.json()
        if (cancelled) return
        setAccounts(data)
      } catch (err) {
        if (cancelled) return
        setAccountsError(err instanceof Error ? err.message : "Failed to load accounts")
      } finally {
        if (!cancelled) setAccountsLoading(false)
      }
    }
    void fetchAccounts()
    return () => { cancelled = true }
  }, [open])

  // Derive the campaign's account list from the saved scrape pairs.
  const selectedAccountIds = useMemo(
    () => Array.from(new Set(scrapePairs.filter((p) => p.saved && p.accountId).map((p) => p.accountId))),
    [scrapePairs],
  )
  const savedPairs = useMemo(
    () => scrapePairs.filter((p) => p.saved && p.accountId && p.guildId),
    [scrapePairs],
  )

  // v0.38: name is optional (auto-defaulted on submit). Templates / rate
  // limits / pacing dropped — warmup wizard doesn't need them.
  const canAdvanceStep0 = templates.some(t => t.trim().length > 0)
  const canAdvanceStep1 = savedPairs.length > 0
  const canSubmit = canAdvanceStep1 && scrapedLeads.length > 0

  // Mirrors the backend's round-robin distribution across selected accounts.
  // No eligibility filter — accounts are in the campaign because the operator
  // chose them; they're already in the same servers as the scraped leads.
  const accountSplitPreview = useMemo(() => {
    if (scrapedLeads.length === 0 || selectedAccountIds.length === 0) return null
    const s = Math.max(1, leadStart ?? 1)
    const e = Math.min(scrapedLeads.length, leadEnd ?? scrapedLeads.length)
    const range = scrapedLeads.slice(s - 1, e)
    const cap = leadsPerAccount > 0 ? leadsPerAccount : Infinity
    const load = new Map<string, number>()
    for (const a of selectedAccountIds) load.set(a, 0)
    let droppedCap = 0
    for (let i = 0; i < range.length; i++) {
      let best: string | null = null
      let bestN = Infinity
      for (const a of selectedAccountIds) {
        const n = load.get(a) || 0
        if (n >= cap) continue
        if (n < bestN) { bestN = n; best = a }
      }
      if (!best) { droppedCap += 1; continue }
      load.set(best, (load.get(best) || 0) + 1)
    }
    return { load, droppedCap, total: range.length }
  }, [scrapedLeads, selectedAccountIds, leadStart, leadEnd, leadsPerAccount])

  const runScrape = async () => {
    return runScrapeInner(false)
  }
  const reScrape = async () => runScrapeInner(true)
  const runScrapeInner = async (force: boolean) => {
    if (savedPairs.length === 0) return
    setScrapeRunning(true)
    setScrapeError(null)
    setScrapeSummary(null)
    const allMembers = new Map<string, { id: string; username: string; globalName: string | null }>()
    const eligibility = new Map<string, Set<string>>()
    let totalFetched = 0
    let anyFromCache = false
    let totalExcludedContacted = 0
    try {
      // v0.53: dedupe scrape work by guild. If 10 accounts share one server,
      // we only fetch that server's member list ONCE (using any one of the
      // paired accounts) instead of doing 10 identical scrapes. Eligibility
      // (which accounts can DM each member) still reflects all paired
      // accounts that are in that guild — it's just no longer derived from
      // who did the scrape.
      const guildMap = new Map<string, { firstPair: typeof savedPairs[number]; accountIds: string[] }>()
      for (const p of savedPairs) {
        const entry = guildMap.get(p.guildId)
        if (entry) entry.accountIds.push(p.accountId)
        else guildMap.set(p.guildId, { firstPair: p, accountIds: [p.accountId] })
      }
      for (const [guildId, { firstPair, accountIds }] of guildMap) {
        const approx = firstPair.approximateMemberCount ?? null
        // v0.58 — applyToAccountIds tells the backend to mirror the scrape
        // under each of the other paired accounts so they all have the
        // eligibility data they need at campaign-create time.
        const applyToAccountIds = accountIds.filter((id) => id !== firstPair.accountId)
        const r = await fetch(`/api/accounts/${firstPair.accountId}/guilds/${guildId}/scrape${force ? "?force=1" : ""}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approximateMemberCount: approx, guildName: firstPair.guildName, applyToAccountIds }),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => null)
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
        const j = await r.json()
        if (j.cached) anyFromCache = true
        if (typeof j.excludedAlreadyContacted === 'number') totalExcludedContacted += j.excludedAlreadyContacted
        totalFetched += j.members.length
        for (const m of j.members) {
          allMembers.set(m.id, m)
          const set = eligibility.get(m.id) || new Set<string>()
          // Every account paired with this guild can reach every member.
          for (const aid of accountIds) set.add(aid)
          eligibility.set(m.id, set)
        }
        // Reflect the scrape outcome on every pair that shares this guild —
        // so the operator's UI doesn't show "loading…" forever for the other
        // 9 pairs they never explicitly scraped.
        setScrapePairs((prev) =>
          prev.map((p) => (p.guildId === guildId
            ? { ...p, membersFound: j.members.length, via: j.via, cached: !!j.cached, scrapedAt: j.scrapedAt }
            : p)),
        )
      }
      setScrapeSummary({ totalMembers: totalFetched, uniqueMembers: allMembers.size, anyFromCache, excludedAlreadyContacted: totalExcludedContacted })
      const leads = Array.from(allMembers.values()).map((m) => ({
        discordUserId: m.id,
        displayName: m.globalName || m.username || undefined,
        eligibleAccountIds: Array.from(eligibility.get(m.id) || []),
      }))
      setScrapedLeads(leads)
      // v0.54: default the queued count to leadsPerAccount × accounts (safe
      // first-run pace). Operator can bump leadsPerAccount or drop into the
      // Advanced range selector for finer control.
      const totalQueued = Math.min(leads.length, leadsPerAccount * Math.max(selectedAccountIds.length, 1))
      setLeadStart(1)
      setLeadEnd(totalQueued)
    } catch (e: any) {
      setScrapeError(e?.message || "scrape failed")
    } finally {
      setScrapeRunning(false)
    }
  }

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Slice the leads to the [start, end] range the operator selected.
      const s = Math.max(1, leadStart ?? 1)
      const e = Math.min(scrapedLeads.length, leadEnd ?? scrapedLeads.length)
      const rangedLeads = scrapedLeads.slice(s - 1, e)
      // v0.38 — warmup-only campaigns. v0.56 — leadsPerAccount sent so the
      // backend hard-caps per-account assignment (no account ever exceeds it).
      const autoName = name.trim() || `Campaign ${new Date().toLocaleDateString()}`
      const cleanTemplates = templates.map(t => t.trim()).filter(Boolean)
      const intervalSecs = minInterSendSeconds > 0 ? minInterSendSeconds : 480 // default 8 min
      // Use the first saved pair's guild as the DM-open context guild so the
      // browser navigates there before POSTing /users/@me/channels — looks like
      // the real user clicking "Message" on a server member's profile.
      const primaryGuildId = savedPairs[0]?.guildId || null
      const body: NewCampaignRequest & { source?: string; leadsPerAccount?: number; minGlobalSpacingSeconds?: number; guildId?: string | null } = {
        name: autoName,
        accountIds: selectedAccountIds,
        leads: rangedLeads,
        templates: cleanTemplates,
        rateLimit: { perHour: 1, perDay: perDay > 0 ? perDay : 20 },
        minInterSendSeconds: intervalSecs,
        minGlobalSpacingSeconds: minGlobalSpacingSeconds > 0 ? minGlobalSpacingSeconds : 300,
        source: `guilds:${savedPairs.map((p) => `${p.guildId}|${encodeURIComponent(p.guildName || "")}`).join(",")}`,
        leadsPerAccount,
        guildId: primaryGuildId,
      }
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Failed to create campaign (${res.status})`)
      }
      const campaign: Campaign = await res.json()
      clearDraftFromStorage()
      onCreated(campaign)
      onOpenChange(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create campaign")
    } finally {
      setSubmitting(false)
    }
  }

  const next = () => {
    if (step === 0 && canAdvanceStep0) setStep(1)
    else if (step === 1 && canAdvanceStep1) setStep(2)
  }
  const back = () => {
    if (step > 0) setStep((step - 1) as StepIndex)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto p-7">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Pick accounts + servers, scrape members, configure your message templates and send interval, then hit Start.
            The engine sends one message per account every interval and round-robins across accounts automatically.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <ol className="flex items-center gap-2 pb-2">
          {STEPS.map((label, idx) => {
            const isActive = idx === step
            const isDone = idx < step
            return (
              <li key={label} className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                    isActive && "border-primary bg-primary text-primary-foreground",
                    isDone && "border-primary/60 bg-primary/10 text-primary",
                    !isActive && !isDone && "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                </div>
                <span className={cn("text-[12px]", isActive ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {label}
                </span>
                {idx < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
              </li>
            )
          })}
        </ol>

        {draftRestored && (
          <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px]">
            <span className="text-amber-900 dark:text-amber-200">
              📝 Continuing a draft you started earlier.
            </span>
            <button
              type="button"
              onClick={() => {
                clearDraftFromStorage()
                setDraftRestored(false)
                setStep(0)
                setName("")
                const bodies = savedTemplates.map((t) => t.body).filter(Boolean)
                setTemplates(bodies.length > 0 ? bodies : [""])
                setPerDay(20)
                setMinInterSendSeconds(0)
                setScrapePairs([{ id: uid(), accountId: "", guildId: "", saved: false }])
                setScrapedLeads([])
                setScrapeSummary(null)
              }}
              className="text-amber-900 underline hover:opacity-80 dark:text-amber-200"
            >
              Discard & start over
            </button>
          </div>
        )}

        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground">Campaign name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Campaign ${new Date().toLocaleDateString()}`}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[12px] font-medium text-foreground">
                  Message templates ({templates.filter(t => t.trim()).length})
                </label>
                <div className="flex items-center gap-3">
                  {/* Saved template picker */}
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
                          <div className="px-3 py-3 text-[11px] text-muted-foreground">
                            No saved templates yet. Click <strong>save</strong> next to any variant below to save it.
                          </div>
                        ) : (
                          <ul className="max-h-60 overflow-y-auto py-1">
                            {savedTemplates.map((t) => (
                              <li key={t.id} className="flex items-start gap-1 px-2 py-1 hover:bg-muted">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTemplates((prev) => [...prev.filter(v => v.trim()), t.body])
                                    setShowSavedPicker(false)
                                  }}
                                  className="flex-1 text-left py-1 px-1"
                                >
                                  {t.name && (
                                    <div className="text-[12px] font-medium text-foreground">{t.name}</div>
                                  )}
                                  <div className={cn("text-[11px] text-muted-foreground line-clamp-2", !t.name && "text-foreground")}>
                                    {t.body}
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  title="Delete saved template"
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    try {
                                      const r = await fetch(`/api/templates/${t.id}`, { method: "DELETE" })
                                      if (r.ok) setSavedTemplates((prev) => prev.filter((s) => s.id !== t.id))
                                    } catch { /* ignore */ }
                                  }}
                                  className="mt-1 shrink-0 p-1 text-muted-foreground hover:text-rose-500"
                                >
                                  <Trash2 className="h-3 w-3" />
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
                    onClick={() => setTemplates((v) => [...v, ""])}
                    className="text-[11px] text-brand hover:underline"
                  >
                    + Add variant
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Engine picks one at random per send. Use <code className="rounded bg-muted px-1">{"{{firstName}}"}</code> for the recipient's name.
              </p>
              <div className="max-h-[35vh] space-y-2 overflow-y-auto">
                {templates.map((v, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <textarea
                      value={v}
                      onChange={(e) => setTemplates((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))}
                      rows={2}
                      className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-[12px] resize-y"
                      placeholder={`Variant ${i + 1}`}
                    />
                    <div className="mt-1 flex flex-col gap-1">
                      {templates.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setTemplates((prev) => prev.filter((_, j) => j !== i))}
                          className="text-[11px] text-muted-foreground hover:text-rose-500"
                        >
                          remove
                        </button>
                      )}
                      {v.trim() && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const r = await fetch("/api/templates", {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ name: v.trim().slice(0, 50), body: v.trim() }),
                              })
                              const j = await r.json()
                              if (r.ok) {
                                setSavedTemplates((prev) => [j, ...prev])
                                setSavedTemplateToast(v.trim().slice(0, 30))
                                setTimeout(() => setSavedTemplateToast(null), 1500)
                              }
                            } catch { /* ignore */ }
                          }}
                          className="text-[11px] text-muted-foreground hover:text-brand"
                          title="Save to template library"
                        >
                          save
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {savedTemplateToast && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                  ✓ Saved: "{savedTemplateToast}…"
                </div>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Pair each sending account with a server it's already in. Members from those servers
              become this campaign's lead list. Add more pairs to use multiple accounts or pull
              from multiple servers.
            </p>
            {accountsLoading && <div className="text-sm text-muted-foreground">Loading accounts…</div>}
            {accountsError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
                {accountsError}
              </div>
            )}
            {!accountsLoading && !accountsError && accounts.length === 0 && (
              <div className="rounded-md border border-dashed border-border bg-muted/40 p-6 text-center text-[12px] text-muted-foreground">
                No accounts yet. Bridge a Discord account from the Accounts page first.
              </div>
            )}

            <MultiPairScrapePanel
              accounts={accounts}
              pairs={scrapePairs}
              setPairs={setScrapePairs}
              guildsByAccount={scrapeGuildsByAccount}
              onFetchGuildsForAccount={async (accountId) => {
                if (scrapeGuildsByAccount[accountId]) return
                try {
                  const r = await fetch(`/api/accounts/${accountId}/guilds`)
                  const j = await r.json()
                  setScrapeGuildsByAccount((g) => ({ ...g, [accountId]: j.guilds || [] }))
                } catch (e: any) {
                  setScrapeError(e?.message || "failed to list guilds")
                }
              }}
            />

            <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
              <strong className="text-foreground">{selectedAccountIds.length}</strong> account
              {selectedAccountIds.length === 1 ? "" : "s"} ·{" "}
              <strong className="text-foreground">{savedPairs.length}</strong> server
              {savedPairs.length === 1 ? "" : "s"} ready to scrape.
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Scrape members from your saved servers, set the send interval, then hit Start.
              The engine fires immediately and sends one message per account per interval, round-robining.
            </p>

            <div className="rounded-md border border-input bg-muted/30 p-3 text-[12px] space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Campaign</span><span className="font-semibold text-foreground">{name || `Campaign ${new Date().toLocaleDateString()}`}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Accounts</span><span className="font-semibold text-foreground">{selectedAccountIds.length}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Servers</span><span className="font-semibold text-foreground">{savedPairs.length}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Per-account interval</span><span className="font-semibold text-foreground">{Math.round((minInterSendSeconds || 480) / 60)} min</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Between-account spacing</span><span className="font-semibold text-foreground">{Math.round((minGlobalSpacingSeconds || 300) / 60)} min</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Templates</span><span className="font-semibold text-foreground">{templates.filter(t => t.trim()).length}</span></div>
              {scrapedLeads.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Leads queued</span>
                  <span className="font-semibold text-foreground">
                    #{(leadStart ?? 1).toLocaleString()}–#{(leadEnd ?? scrapedLeads.length).toLocaleString()}
                    {" "}({Math.max(0, (leadEnd ?? scrapedLeads.length) - (leadStart ?? 1) + 1).toLocaleString()} of {scrapedLeads.length.toLocaleString()})
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-md border border-input bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-foreground">Members scraped</div>
                  <div className="text-[11px] text-muted-foreground">
                    {scrapedLeads.length > 0
                      ? `${scrapeSummary?.uniqueMembers.toLocaleString() ?? scrapedLeads.length.toLocaleString()} unique leads ready`
                      : "Hit Scrape members to pull the list."}
                    {scrapeSummary?.anyFromCache && (
                      <span className="ml-2 rounded-chip bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                        from cache
                      </span>
                    )}
                  </div>
                  {scrapedLeads.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      {savedPairs.map((p) => (
                        <span key={p.id}>
                          <strong className="text-foreground/70">{p.guildName || p.guildId.slice(0, 8)}</strong>
                          {p.cached && p.scrapedAt
                            ? ` · cached ${relativeTime(p.scrapedAt)}`
                            : p.via
                              ? ` · via ${p.via}`
                              : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {scrapedLeads.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" disabled={scrapeRunning || savedPairs.length === 0} onClick={reScrape}
                      title="Discard the cached results and hit Discord again"
                    >
                      {scrapeRunning ? "Re-scraping…" : "Re-scrape"}
                    </Button>
                  )}
                  <Button type="button" variant="secondary" disabled={scrapeRunning || savedPairs.length === 0} onClick={runScrape}>
                    {scrapeRunning ? "Scraping…" : scrapedLeads.length > 0 ? "Reload" : "Scrape members"}
                  </Button>
                </div>
              </div>
              {scrapeError && (
                <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-900 dark:text-red-200">
                  {scrapeError}
                </div>
              )}
              {scrapeSummary && scrapeSummary.totalMembers !== scrapeSummary.uniqueMembers && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {scrapeSummary.totalMembers.toLocaleString()} total across servers, deduped to{" "}
                  {scrapeSummary.uniqueMembers.toLocaleString()} unique.
                </div>
              )}
              {scrapeSummary && (scrapeSummary.excludedAlreadyContacted ?? 0) > 0 && (
                <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                  ✓ Excluded <strong>{scrapeSummary.excludedAlreadyContacted!.toLocaleString()}</strong> lead{scrapeSummary.excludedAlreadyContacted === 1 ? "" : "s"} already contacted in past warmups (no duplicate sends).
                </div>
              )}
              {scrapedLeads.length > 0 && (
                <details className="mt-2 text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">Preview first 10 leads</summary>
                  <ul className="mt-1 max-h-32 overflow-y-auto font-mono">
                    {scrapedLeads.slice(0, 10).map((l) => (
                      <li key={l.discordUserId} className="truncate">
                        {l.discordUserId}{l.displayName ? ` · ${l.displayName}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {scrapedLeads.length > 0 && (
              <div className="rounded-md border border-input bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-foreground">Leads per account</label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Each account opens this many empty chats — and ONLY those. No account ever gets all the leads.
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={leadsPerAccount}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(500, Number(e.target.value) || 1))
                      setLeadsPerAccount(v)
                      // Sync the range: take the first (v × accounts) leads.
                      const totalQueued = Math.min(scrapedLeads.length, v * Math.max(selectedAccountIds.length, 1))
                      setLeadStart(1)
                      setLeadEnd(totalQueued)
                    }}
                    className="h-8 w-20 text-center"
                  />
                </div>
                <div className="rounded bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  <strong className="text-foreground">{leadsPerAccount} leads</strong>
                  {" "}×{" "}
                  <strong className="text-foreground">{selectedAccountIds.length} account{selectedAccountIds.length === 1 ? '' : 's'}</strong>
                  {" "}={" "}
                  <strong className="text-foreground">{Math.min(scrapedLeads.length, leadsPerAccount * selectedAccountIds.length)} leads</strong>
                  {" "}queued total
                  {leadsPerAccount * selectedAccountIds.length > scrapedLeads.length && (
                    <> · capped to {scrapedLeads.length} scraped</>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-md border border-input bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-[12px] font-medium text-foreground">Send interval per account</label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Minimum minutes before the same account sends again.{" "}
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">Recommended: 8–15 min.</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Input
                    type="number"
                    min={1}
                    value={Math.round(minInterSendSeconds / 60) || 8}
                    onChange={(e) => setMinInterSendSeconds(Math.max(1, Number(e.target.value) || 8) * 60)}
                    className="h-8 w-20 text-center"
                  />
                  <span className="text-[12px] text-muted-foreground">min</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[5, 8, 15, 30, 60].map(mins => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setMinInterSendSeconds(mins * 60)}
                    className={cn(
                      "rounded-chip px-2 py-0.5 text-[10px] font-medium transition-colors",
                      Math.round(minInterSendSeconds / 60) === mins
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    )}
                  >
                    {mins}m{mins === 8 ? " ★" : ""}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-input bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-[12px] font-medium text-foreground">Between-account spacing</label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Minimum wait between ANY two sends, regardless of which account.{" "}
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">Recommended: 5 min.</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Input
                    type="number"
                    min={1}
                    value={Math.round(minGlobalSpacingSeconds / 60) || 5}
                    onChange={(e) => setMinGlobalSpacingSeconds(Math.max(1, Number(e.target.value) || 5) * 60)}
                    className="h-8 w-20 text-center"
                  />
                  <span className="text-[12px] text-muted-foreground">min</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[1, 3, 5, 10, 15].map(mins => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setMinGlobalSpacingSeconds(mins * 60)}
                    className={cn(
                      "rounded-chip px-2 py-0.5 text-[10px] font-medium transition-colors",
                      Math.round(minGlobalSpacingSeconds / 60) === mins
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    )}
                  >
                    {mins}m{mins === 5 ? " ★" : ""}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-input bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-[12px] font-medium text-foreground">Daily DMs per account</label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Max DMs each account sends per 24 h. Engine stops that account for the day once reached.{" "}
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">Recommended: 20.</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Input
                    type="number"
                    min={1}
                    value={perDay || 20}
                    onChange={(e) => setPerDay(Math.max(1, Number(e.target.value) || 20))}
                    className="h-8 w-20 text-center"
                  />
                  <span className="text-[12px] text-muted-foreground">/ day</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[10, 20, 30, 50].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPerDay(n)}
                    className={cn(
                      "rounded-chip px-2 py-0.5 text-[10px] font-medium transition-colors",
                      perDay === n
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    )}
                  >
                    {n}{n === 20 ? " ★" : ""}
                  </button>
                ))}
              </div>
            </div>

            {scrapedLeads.length > 0 && (
              <details className="rounded-md border border-input bg-muted/20 p-3">
                <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                  Advanced — pick a specific lead range instead
                </summary>
                <div className="mt-2">
                  <LeadRangeSelector
                    total={scrapedLeads.length}
                    start={leadStart ?? 1}
                    end={leadEnd ?? scrapedLeads.length}
                    leads={scrapedLeads}
                    onChange={(s, e) => { setLeadStart(s); setLeadEnd(e) }}
                  />
                </div>
              </details>
            )}

            {accountSplitPreview && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="mb-2 text-[12px] font-medium text-foreground">
                  ✓ Per-account assignment (what will happen)
                </div>
                <ul className="space-y-1 text-[11px]">
                  {Array.from(accountSplitPreview.load.entries()).map(([accountId, n]) => {
                    const acct = accounts.find((a) => a.id === accountId)
                    return (
                      <li key={accountId} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{acct ? (acct.label || acct.username) : accountId.slice(0, 10)}</span>
                        <span className="font-semibold text-foreground">{n} {n === 1 ? "lead" : "leads"}</span>
                      </li>
                    )
                  })}
                  {accountSplitPreview.droppedCap > 0 && (
                    <li className="flex items-center justify-between gap-2 border-t border-input pt-1 text-muted-foreground">
                      <span>skipped (every account at the {leadsPerAccount}/account cap)</span>
                      <span className="font-semibold">{accountSplitPreview.droppedCap}</span>
                    </li>
                  )}
                </ul>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Hard cap: no account exceeds <strong>{leadsPerAccount}</strong> leads.
                </p>
              </div>
            )}

            {!canSubmit && scrapedLeads.length === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Scrape at least one server before starting the campaign.
              </div>
            )}
          </div>
        )}

        {submitError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
            {submitError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={step === 0 ? () => onOpenChange(false) : back}
              disabled={submitting}
            >
              {step === 0 ? "Cancel" : (<><ArrowLeft className="h-4 w-4" /> Back</>)}
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={submitting}
              onClick={() => {
                saveDraftToStorage({
                  step, name, templates, perDay, minInterSendSeconds, scrapePairs,
                })
                setDraftSavedToast(true)
                setTimeout(() => {
                  setDraftSavedToast(false)
                  onOpenChange(false)
                }, 600)
              }}
              className="text-muted-foreground hover:text-foreground"
              title="Save your progress and pick up where you left off next time"
            >
              {draftSavedToast ? "✓ Saved" : "Save & close"}
            </Button>
          </div>
          {step < 2 ? (
            <Button onClick={next} disabled={step === 0 ? !canAdvanceStep0 : !canAdvanceStep1}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={!canSubmit || submitting}>
              {submitting
                ? "Creating…"
                : <><Rocket className="h-4 w-4" /> Create &amp; start</>}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ───── LeadRangeSelector ───────────────────────────────────────────────────
// Two-handle range slider for picking which scraped leads to actually queue.
// Lets the operator say "leads 50-100" instead of just "first N". Both bounds
// are 1-indexed inclusive. Renders as two overlapping <input type=range>'s
// with a coloured track between them + quick-pick chips.

function LeadRangeSelector(props: {
  total: number
  start: number
  end: number
  leads: ParsedLead[]
  onChange: (start: number, end: number) => void
}) {
  const { total, start, end, leads, onChange } = props
  // Clamp helpers — guard against out-of-order handles when one is dragged past the other.
  const setStart = (v: number) => {
    const clamped = Math.max(1, Math.min(total, v))
    onChange(Math.min(clamped, end), end)
  }
  const setEnd = (v: number) => {
    const clamped = Math.max(1, Math.min(total, v))
    onChange(start, Math.max(clamped, start))
  }
  const count = Math.max(0, end - start + 1)
  const startPct = ((start - 1) / Math.max(1, total - 1)) * 100
  const endPct = ((end - 1) / Math.max(1, total - 1)) * 100

  // Display-name lookup for the lead at a given 1-indexed position. Falls back
  // to the Discord user id when the scraper didn't return a display name.
  const labelAt = (pos: number): string => {
    const lead = leads[pos - 1]
    if (!lead) return ""
    return lead.displayName || lead.discordUserId
  }
  const startName = labelAt(start)
  const endName = labelAt(end)

  return (
    <div className="space-y-2 rounded-md border border-input bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[12px] font-medium text-foreground">Lead range to queue</label>
        <div className="flex flex-col items-end">
          <div className="flex items-baseline gap-1">
            <span className="text-base font-semibold tabular-nums text-foreground">
              #{start.toLocaleString()}–#{end.toLocaleString()}
            </span>
            <span className="text-[11px] text-muted-foreground">
              ({count.toLocaleString()} of {total.toLocaleString()})
            </span>
          </div>
          {(startName || endName) && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              <span className="text-foreground/70">{startName}</span>
              {start !== end && (
                <>
                  <span className="mx-1">→</span>
                  <span className="text-foreground/70">{endName}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dual range — two transparent <input type=range>'s on top of a coloured track. */}
      <div className="relative h-7 select-none">
        {/* Track */}
        <div className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full bg-input" />
        {/* Selected portion */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
        />
        <input
          type="range"
          min={1}
          max={total}
          step={1}
          value={start}
          onChange={(e) => setStart(Number(e.target.value) || 1)}
          className="pointer-events-none absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto"
          aria-label="Range start"
        />
        <input
          type="range"
          min={1}
          max={total}
          step={1}
          value={end}
          onChange={(e) => setEnd(Number(e.target.value) || total)}
          className="pointer-events-none absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto"
          aria-label="Range end"
        />
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1 text-muted-foreground">From&nbsp;#
          <Input
            type="number" min={1} max={total} value={start}
            onChange={(e) => setStart(Number(e.target.value) || 1)}
            className="h-7 w-20 text-[12px]"
          />
        </label>
        <label className="flex items-center gap-1 text-muted-foreground">To&nbsp;#
          <Input
            type="number" min={1} max={total} value={end}
            onChange={(e) => setEnd(Number(e.target.value) || total)}
            className="h-7 w-20 text-[12px]"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        <button type="button" onClick={() => onChange(1, Math.min(5, total))}
          className="rounded-chip border border-input bg-background px-2 py-0.5 hover:bg-muted"
        >First 5</button>
        <button type="button" onClick={() => onChange(1, Math.min(25, total))}
          className="rounded-chip border border-input bg-background px-2 py-0.5 hover:bg-muted"
        >First 25</button>
        <button type="button" onClick={() => onChange(1, Math.min(100, total))}
          className="rounded-chip border border-input bg-background px-2 py-0.5 hover:bg-muted"
        >First 100</button>
        <button type="button" onClick={() => onChange(Math.max(1, total - 24), total)}
          className="rounded-chip border border-input bg-background px-2 py-0.5 hover:bg-muted"
        >Last 25</button>
        <button type="button" onClick={() => onChange(Math.max(1, total - 99), total)}
          className="rounded-chip border border-input bg-background px-2 py-0.5 hover:bg-muted"
        >Last 100</button>
        <button type="button" onClick={() => onChange(1, total)}
          className="rounded-chip border border-input bg-background px-2 py-0.5 hover:bg-muted"
        >All ({total.toLocaleString()})</button>
      </div>

      <p className="text-[11px] text-muted-foreground/80">
        Drag either handle, type exact numbers, or use a quick preset. Useful when you've already
        sent to the top of the list and want to resume from where you left off.
      </p>
    </div>
  )
}

// ───── MultiPairScrapePanel ──────────────────────────────────────────────────
// Stackable [Account → Server] rows. Each row is independently savable; the
// "+ Add another" button adds new ones. Members are scraped on Step 3.

function MultiPairScrapePanel(props: {
  accounts: DiscordAccount[]
  pairs: ScrapePair[]
  setPairs: React.Dispatch<React.SetStateAction<ScrapePair[]>>
  guildsByAccount: Record<string, GuildOption[]>
  onFetchGuildsForAccount: (accountId: string) => Promise<void>
}) {
  const { accounts, pairs, setPairs, guildsByAccount, onFetchGuildsForAccount } = props
  const connectedAccounts = accounts.filter((a) => a.status === "connected")
  // v0.52 — per-pair "checking…" state for the "apply to other accounts"
  // button so the operator gets progress feedback while we probe each
  // account's guild list. Also stores the last result message per pair.
  const [checkingPairId, setCheckingPairId] = useState<string | null>(null)
  const [checkProgress, setCheckProgress] = useState<{ pairId: string; done: number; total: number } | null>(null)
  const [checkResult, setCheckResult] = useState<{ pairId: string; added: number; checked: number } | null>(null)

  return (
    <div className="space-y-3 rounded-md border border-input bg-muted/30 p-3">
      {pairs.map((pair, idx) => {
        const guilds = guildsByAccount[pair.accountId] || []
        return (
          <div key={pair.id} className={cn("rounded-md border bg-background", pair.saved ? "border-emerald-500/30" : "border-input")}>
            <div className="flex items-center justify-between border-b border-input/60 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pair {idx + 1}
                {pair.saved && pair.membersFound !== undefined && (
                  <span className="ml-2 text-emerald-700 dark:text-emerald-400 normal-case">
                    · {pair.membersFound.toLocaleString()} members
                    {pair.via && <span className="ml-1 text-muted-foreground">(via {pair.via})</span>}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {pair.saved && (
                  <button
                    type="button"
                    onClick={() => setPairs((prev) => prev.map((p) => (p.id === pair.id ? { ...p, saved: false } : p)))}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Edit
                  </button>
                )}
                {pairs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPairs((prev) => prev.filter((p) => p.id !== pair.id))}
                    className="text-[11px] text-muted-foreground hover:text-red-500"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {pair.saved ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
                <div className="text-foreground">
                  <span className="font-medium">
                    {(() => {
                      const a = accounts.find((x) => x.id === pair.accountId)
                      return a ? (a.label || a.username) : "?"
                    })()}
                  </span>{" "}
                  in <span className="font-medium">{pair.guildName || pair.guildId}</span>
                </div>
                {/* v0.37/v0.51: one-click expand the same server across every
                    connected account THAT IS ACTUALLY IN IT. The count only
                    reflects accounts whose guild list we've already fetched and
                    that contain this guildId — so the operator doesn't see
                    "apply to 44" when they only joined that server with 4
                    accounts. Click triggers discovery for any unloaded
                    accounts and adds only the verified matches. */}
                {(() => {
                  const otherAccounts = connectedAccounts.filter((a) =>
                    a.id !== pair.accountId
                    && !pairs.some((p) => p.accountId === a.id && p.guildId === pair.guildId)
                  )
                  if (otherAccounts.length === 0) return null
                  // Count only accounts whose guild list is loaded AND confirms
                  // membership. Unloaded accounts are excluded from the count
                  // but still get probed on click.
                  const verifiedMatches = otherAccounts.filter((a) => {
                    const guilds = guildsByAccount[a.id]
                    return Array.isArray(guilds) && guilds.some((g) => g.id === pair.guildId)
                  })
                  const unknownCount = otherAccounts.length - otherAccounts.filter((a) => Array.isArray(guildsByAccount[a.id])).length
                  const isChecking = checkingPairId === pair.id
                  const progress = checkProgress && checkProgress.pairId === pair.id ? checkProgress : null
                  const result = checkResult && checkResult.pairId === pair.id ? checkResult : null
                  return (
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <button
                        type="button"
                        disabled={isChecking}
                        onClick={async () => {
                          setCheckingPairId(pair.id)
                          setCheckResult(null)
                          setCheckProgress({ pairId: pair.id, done: 0, total: otherAccounts.length })
                          const targets: { acct: DiscordAccount; guildName: string | undefined; approx: number | null }[] = []
                          let checked = 0
                          for (const acct of otherAccounts) {
                            let guilds = guildsByAccount[acct.id]
                            if (!guilds) {
                              try { await onFetchGuildsForAccount(acct.id) } catch { /* skip */ }
                              guilds = guildsByAccount[acct.id]
                            }
                            const match = (guilds || []).find((g) => g.id === pair.guildId)
                            if (match) targets.push({ acct, guildName: match.name, approx: match.approximateMemberCount ?? null })
                            checked += 1
                            setCheckProgress({ pairId: pair.id, done: checked, total: otherAccounts.length })
                          }
                          if (targets.length > 0) {
                            setPairs((prev) => [
                              ...prev,
                              ...targets.map(({ acct, guildName, approx }) => ({
                                id: uid(),
                                accountId: acct.id,
                                guildId: pair.guildId,
                                guildName,
                                approximateMemberCount: approx,
                                saved: true,
                              })),
                            ])
                          }
                          setCheckingPairId(null)
                          setCheckProgress(null)
                          setCheckResult({ pairId: pair.id, added: targets.length, checked })
                        }}
                        className="rounded-chip bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/25 disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Add every other connected account that's also in this server (verified by checking each account's guild list)"
                      >
                        {isChecking
                          ? `Checking… ${progress?.done ?? 0}/${progress?.total ?? otherAccounts.length}`
                          : verifiedMatches.length > 0
                            ? `+ apply to ${verifiedMatches.length} other in this server`
                            : unknownCount > 0
                              ? `+ check ${unknownCount} other account${unknownCount === 1 ? '' : 's'}`
                              : "+ no other accounts in this server"}
                      </button>
                      {result && !isChecking && (
                        <span className={`text-[10px] ${result.added > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>
                          {result.added > 0
                            ? `✓ added ${result.added} of ${result.checked} checked`
                            : `checked ${result.checked} — none in this server`}
                        </span>
                      )}
                    </div>
                  )
                })()}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 p-2.5 sm:grid-cols-[1fr_1fr_auto]">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">Account</label>
                  <select
                    value={pair.accountId}
                    onChange={(e) => {
                      const accountId = e.target.value
                      setPairs((prev) => prev.map((p) => (p.id === pair.id ? { ...p, accountId, guildId: "", guildName: undefined } : p)))
                      if (accountId) onFetchGuildsForAccount(accountId)
                    }}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-[12px] text-foreground"
                  >
                    <option value="">— pick an account —</option>
                    {connectedAccounts
                      .slice()
                      .sort((a, b) => (a.label || a.username || '').localeCompare(b.label || b.username || '', undefined, { sensitivity: 'base' }))
                      .map((a) => (
                        // v0.50: show Discord display name (label) as the
                        // primary option text, falling back to the handle.
                        // Handle is shown small in parens so the operator
                        // can still disambiguate if two accounts share a
                        // display name.
                        <option key={a.id} value={a.id}>
                          {a.label || a.username} ({`@${a.username}`})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">Server</label>
                  <select
                    value={pair.guildId}
                    disabled={!pair.accountId || guilds.length === 0}
                    onChange={(e) => {
                      const guildId = e.target.value
                      const g = guilds.find((gg) => gg.id === guildId)
                      setPairs((prev) =>
                        prev.map((p) =>
                          p.id === pair.id
                            ? { ...p, guildId, guildName: g?.name, approximateMemberCount: g?.approximateMemberCount ?? null }
                            : p,
                        ),
                      )
                    }}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-[12px] text-foreground disabled:opacity-50"
                  >
                    <option value="">
                      {!pair.accountId ? "pick account first" : guilds.length === 0 ? "loading…" : "— pick a server —"}
                    </option>
                    {guilds.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}{g.approximateMemberCount ? ` (~${g.approximateMemberCount.toLocaleString()})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    disabled={!pair.accountId || !pair.guildId}
                    onClick={() => setPairs((prev) => prev.map((p) => (p.id === pair.id ? { ...p, saved: true } : p)))}
                    variant="secondary"
                    className="h-8 w-full text-[12px] sm:w-auto"
                  >
                    Save pair
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={() =>
          setPairs((prev) => [...prev, { id: uid(), accountId: "", guildId: "", saved: false }])
        }
        className="w-full rounded-md border border-dashed border-input px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        + Add another pair (different account or server)
      </button>

      <p className="text-[11px] text-muted-foreground/80">
        Pairing an account with the server it's in is the only safe way to send DMs — Discord
        rejects DMs to strangers with no mutual server (50007). Small servers use OP 8 (fast);
        larger ones auto-fall back to OP 14 lazy-loading.
      </p>
    </div>
  )
}
