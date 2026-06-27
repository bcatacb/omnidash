import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertTriangle, ArrowLeft, ArrowRight, Check, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { DiscordAccount, FrCampaign, FrCampaignMode } from "@/api-types"

function uid(): string {
  try { return crypto.randomUUID() } catch { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }
}

type ParsedLead = { discordUserId: string; displayName?: string; username?: string }
type ScrapePair = {
  id: string
  accountId: string
  guildId: string
  guildName?: string
  approximateMemberCount?: number | null
  saved: boolean
  membersFound?: number
  via?: "op8" | "op14" | "cache"
  cached?: boolean
  scrapedAt?: string
}
type GuildOption = { id: string; name: string; iconUrl: string | null; approximateMemberCount: number | null }

const STEPS = ["Setup", "Servers", "Scrape & start"] as const
type StepIndex = 0 | 1 | 2

const MODE_OPTIONS: { value: FrCampaignMode; label: string; desc: string }[] = [
  { value: "fr_only",    label: "FR only",    desc: "Send FR. On acceptance, auto-send a template DM." },
  { value: "dm_then_fr", label: "DM → FR",    desc: "Outreach DM sent first, then FR after combo interval." },
  { value: "fr_then_dm", label: "FR → DM",    desc: "Send FR first, then DM after combo interval." },
]

function relativeTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime()
    const s = Math.floor(ms / 1000)
    if (s < 60) return "just now"
    const m = Math.floor(s / 60)
    if (m < 60) return `${m} min ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  } catch { return iso }
}

interface Props {
  onClose: () => void
  onCreated: (campaign: FrCampaign) => void
}

export default function FrCampaignWizard({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<StepIndex>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [mode, setMode] = useState<FrCampaignMode>("fr_only")
  const [template, setTemplate] = useState("")
  const [perDay, setPerDay] = useState(20)
  const [minInterval, setMinInterval] = useState(300)
  const [maxInterval, setMaxInterval] = useState(900)
  const [comboSeconds, setComboSeconds] = useState(300)
  const [interSendSeconds, setInterSendSeconds] = useState(60)


  const [accounts, setAccounts] = useState<DiscordAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [scrapePairs, setScrapePairs] = useState<ScrapePair[]>([
    { id: uid(), accountId: "", guildId: "", saved: false },
  ])
  const [scrapeGuildsByAccount, setScrapeGuildsByAccount] = useState<Record<string, GuildOption[]>>({})

  const [scrapeRunning, setScrapeRunning] = useState(false)
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [scrapedLeads, setScrapedLeads] = useState<ParsedLead[]>([])
  const [scrapeSummary, setScrapeSummary] = useState<{ totalMembers: number; uniqueMembers: number; anyFromCache?: boolean } | null>(null)
  const [leadsPerAccount, setLeadsPerAccount] = useState(5)

  useEffect(() => {
    let cancelled = false
    setAccountsLoading(true)
    setAccountsError(null)
    fetch("/api/accounts")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then((data: DiscordAccount[]) => { if (!cancelled) setAccounts(data) })
      .catch((err) => { if (!cancelled) setAccountsError(err.message || "Failed to load accounts") })
      .finally(() => { if (!cancelled) setAccountsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const savedPairs = useMemo(
    () => scrapePairs.filter((p) => p.saved && p.accountId && p.guildId),
    [scrapePairs],
  )
  const selectedAccountIds = useMemo(
    () => Array.from(new Set(savedPairs.map((p) => p.accountId))),
    [savedPairs],
  )

  const canNextStep0 = name.trim().length > 0
  const canNextStep1 = savedPairs.length > 0
  const canSubmit = canNextStep1 && scrapedLeads.length > 0

  const runScrape = async (force = false) => {
    if (savedPairs.length === 0) return
    setScrapeRunning(true)
    setScrapeError(null)
    setScrapeSummary(null)
    const allMembers = new Map<string, { id: string; username: string; globalName: string | null }>()
    let totalFetched = 0
    let anyFromCache = false
    try {
      const guildMap = new Map<string, { firstPair: ScrapePair; accountIds: string[] }>()
      for (const p of savedPairs) {
        const entry = guildMap.get(p.guildId)
        if (entry) entry.accountIds.push(p.accountId)
        else guildMap.set(p.guildId, { firstPair: p, accountIds: [p.accountId] })
      }
      for (const [guildId, { firstPair, accountIds }] of guildMap) {
        const approx = firstPair.approximateMemberCount ?? null
        const applyToAccountIds = accountIds.filter((id) => id !== firstPair.accountId)
        const r = await fetch(
          `/api/accounts/${firstPair.accountId}/guilds/${guildId}/scrape${force ? "?force=1" : ""}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ approximateMemberCount: approx, guildName: firstPair.guildName, applyToAccountIds }),
          },
        )
        if (!r.ok) {
          const body = await r.json().catch(() => null)
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
        const j = await r.json()
        if (j.cached) anyFromCache = true
        totalFetched += j.members.length
        for (const m of j.members) allMembers.set(m.id, m)
        setScrapePairs((prev) =>
          prev.map((p) =>
            p.guildId === guildId
              ? { ...p, membersFound: j.members.length, via: j.via, cached: !!j.cached, scrapedAt: j.scrapedAt }
              : p,
          ),
        )
      }
      setScrapeSummary({ totalMembers: totalFetched, uniqueMembers: allMembers.size, anyFromCache })
      setScrapedLeads(
        Array.from(allMembers.values()).map((m) => ({
          discordUserId: m.id,
          displayName: m.globalName || m.username || undefined,
          username: m.username || undefined,
        })),
      )
    } catch (e: any) {
      setScrapeError(e?.message || "Scrape failed")
    } finally {
      setScrapeRunning(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/fr-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || `FR ${new Date().toLocaleDateString()}`,
          mode,
          template: template.trim() || undefined,
          fr_per_account_per_day: perDay,
          min_interval_seconds: minInterval,
          max_interval_seconds: maxInterval,
          combo_interval_seconds: comboSeconds,
          inter_send_seconds: interSendSeconds,
        }),
      })
      if (!res.ok) throw new Error(`Failed to create campaign (${res.status})`)
      const campaign: FrCampaign = await res.json()

      const cap = Math.min(scrapedLeads.length, leadsPerAccount * Math.max(selectedAccountIds.length, 1))
      const leadsToImport = scrapedLeads.slice(0, cap)
      if (leadsToImport.length > 0) {
        await fetch(`/api/fr-campaigns/${campaign.id}/leads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leads: leadsToImport.map((l) => ({
              discord_user_id: l.discordUserId,
              display_name: l.displayName ?? null,
              username: l.username ?? null,
            })),
          }),
        })
      }

      await fetch(`/api/fr-campaigns/${campaign.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "running" }),
      })

      onCreated(campaign)
    } catch (err: any) {
      setError(err?.message || "Failed to create campaign")
    } finally {
      setBusy(false)
    }
  }

  const next = () => {
    if (step === 0 && canNextStep0) setStep(1)
    else if (step === 1 && canNextStep1) setStep(2)
  }
  const back = () => { if (step > 0) setStep((step - 1) as StepIndex) }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto p-7">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-blue-500" />
            New friend request campaign
          </DialogTitle>
        </DialogHeader>

        <ol className="flex items-center gap-2 pb-2">
          {STEPS.map((label, idx) => {
            const isActive = idx === step
            const isDone = idx < step
            return (
              <li key={label} className="flex items-center gap-2">
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                  isActive && "border-primary bg-primary text-primary-foreground",
                  isDone && "border-primary/60 bg-primary/10 text-primary",
                  !isActive && !isDone && "border-border bg-muted text-muted-foreground",
                )}>
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

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label className="text-[12px] font-medium text-foreground mb-1 block">Campaign name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Server X FR outreach" autoFocus />
            </div>

            <div>
              <label className="text-[12px] font-medium text-foreground mb-2 block">Mode</label>
              <div className="space-y-2">
                {MODE_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button" onClick={() => setMode(opt.value)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      mode === opt.value ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent"
                    )}
                  >
                    <div className="text-[13px] font-semibold">{opt.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium text-foreground mb-1 block">
                {mode === "fr_only"
                  ? <>Template DM <span className="font-normal text-muted-foreground">(sent automatically on FR acceptance)</span></>
                  : mode === "dm_then_fr"
                    ? <>Outreach DM template <span className="font-normal text-muted-foreground">(sent before FR)</span></>
                    : <>Combo DM template <span className="font-normal text-muted-foreground">(sent after FR, after combo interval)</span></>}
              </label>
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={3}
                placeholder="Hey {{firstName}}, ..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            {(mode === "dm_then_fr" || mode === "fr_then_dm") && (
              <div>
                <label className="text-[12px] font-medium text-foreground mb-1 block">
                  Combo interval <span className="font-normal text-muted-foreground">(seconds between DM and FR)</span>
                </label>
                <div className="flex items-center gap-2">
                  <Input type="number" min={60} value={comboSeconds}
                    onChange={(e) => setComboSeconds(Math.max(60, Number(e.target.value)))}
                    className="w-24 text-center"
                  />
                  <span className="text-[12px] text-muted-foreground">seconds</span>
                  <div className="flex gap-1">
                    {[300, 600, 1800].map((s) => (
                      <button key={s} type="button" onClick={() => setComboSeconds(s)}
                        className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                          comboSeconds === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                        )}>
                        {s / 60}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-foreground mb-1 block">FRs/account/day</label>
                <Input type="number" min={1} max={100} value={perDay}
                  onChange={(e) => setPerDay(Math.max(1, Number(e.target.value)))} className="text-center" />
                <p className="mt-0.5 text-[10px] text-muted-foreground">Recommended: 20</p>
              </div>
              <div>
                <label className="text-[12px] font-medium text-foreground mb-1 block">Inter-send interval (s)</label>
                <Input type="number" min={30} value={interSendSeconds}
                  onChange={(e) => setInterSendSeconds(Math.max(30, Number(e.target.value)))} className="text-center" />
                <p className="mt-0.5 text-[10px] text-muted-foreground">Global gap between any two FRs. Recommended: <strong>60s</strong></p>
              </div>
              <div>
                <label className="text-[12px] font-medium text-foreground mb-1 block">Per-account min (s)</label>
                <Input type="number" min={60} value={minInterval}
                  onChange={(e) => setMinInterval(Math.max(60, Number(e.target.value)))} className="text-center" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-foreground mb-1 block">Per-account max (s)</label>
                <Input type="number" min={60} value={maxInterval}
                  onChange={(e) => setMaxInterval(Math.max(minInterval, Number(e.target.value)))} className="text-center" />
              </div>
            </div>
            <p className="text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded px-2 py-1.5">
              Inter-send = global gap between any FR send. Per-account = cooldown per account. Higher = safer tokens.
            </p>

          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Pair each sending account with a server it's already in. Members from those servers become FR leads.
            </p>
            {accountsLoading && (
              <div className="text-sm text-muted-foreground">Loading accounts…</div>
            )}
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
                } catch { /* silent */ }
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
              Scrape members from your selected servers. The engine will send friend requests to them.
            </p>

            <div className="rounded-md border border-input bg-muted/30 p-3 text-[12px] space-y-1.5">
              <Row label="Campaign" value={name || `FR ${new Date().toLocaleDateString()}`} />
              <Row label="Mode" value={MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode} />
              <Row label="Servers" value={String(savedPairs.length)} />
              <Row label="FR/account/day" value={String(perDay)} />
              <Row label="Inter-send" value={`${interSendSeconds}s`} />
              <Row label="Per-account interval" value={`${minInterval}–${maxInterval}s`} />
              {(mode === "dm_then_fr" || mode === "fr_then_dm") && (
                <Row label="Combo delay" value={`${comboSeconds}s`} />
              )}
            </div>

            <div className="rounded-md border border-input bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-foreground">Members scraped</div>
                  <div className="text-[11px] text-muted-foreground">
                    {scrapedLeads.length > 0
                      ? `${(scrapeSummary?.uniqueMembers ?? scrapedLeads.length).toLocaleString()} unique leads ready`
                      : "Hit Scrape members to pull the list."}
                    {scrapeSummary?.anyFromCache && (
                      <span className="ml-2 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
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
                            : p.via ? ` · via ${p.via}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {scrapedLeads.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" disabled={scrapeRunning}
                      onClick={() => runScrape(true)}>
                      {scrapeRunning ? "Re-scraping…" : "Re-scrape"}
                    </Button>
                  )}
                  <Button type="button" variant="secondary" disabled={scrapeRunning || savedPairs.length === 0}
                    onClick={() => runScrape()}>
                    {scrapeRunning ? "Scraping…" : scrapedLeads.length > 0 ? "Reload" : "Scrape members"}
                  </Button>
                </div>
              </div>
              {scrapeError && (
                <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-900 dark:text-red-200">
                  {scrapeError}
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
                      How many FR targets each account gets. Capped to scraped total.
                    </p>
                  </div>
                  <Input
                    type="number" min={1} max={500} value={leadsPerAccount}
                    onChange={(e) => setLeadsPerAccount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                    className="h-8 w-20 text-center"
                  />
                </div>
                <div className="rounded bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  <strong className="text-foreground">{leadsPerAccount} leads</strong>
                  {" "}×{" "}
                  <strong className="text-foreground">
                    {Math.max(selectedAccountIds.length, 1)} account{selectedAccountIds.length === 1 ? "" : "s"}
                  </strong>
                  {" "}={" "}
                  <strong className="text-foreground">
                    {Math.min(scrapedLeads.length, leadsPerAccount * Math.max(selectedAccountIds.length, 1)).toLocaleString()} leads
                  </strong>
                  {" "}queued
                  {leadsPerAccount * Math.max(selectedAccountIds.length, 1) > scrapedLeads.length && (
                    <> · capped to {scrapedLeads.length.toLocaleString()} scraped</>
                  )}
                </div>
              </div>
            )}

            {!canSubmit && scrapedLeads.length === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Scrape at least one server before creating the campaign.
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="ghost" onClick={step === 0 ? onClose : back} disabled={busy}>
            {step === 0 ? "Cancel" : <><ArrowLeft className="h-4 w-4 mr-1" /> Back</>}
          </Button>
          {step < 2 ? (
            <Button onClick={next} disabled={step === 0 ? !canNextStep0 : !canNextStep1}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={!canSubmit || busy}>
              {busy ? "Creating…" : "Create & start"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  )
}

function MultiPairScrapePanel(props: {
  accounts: DiscordAccount[]
  pairs: ScrapePair[]
  setPairs: (fn: (prev: ScrapePair[]) => ScrapePair[]) => void
  guildsByAccount: Record<string, GuildOption[]>
  onFetchGuildsForAccount: (accountId: string) => Promise<void>
}) {
  const { accounts, pairs, setPairs, guildsByAccount, onFetchGuildsForAccount } = props
  const connectedAccounts = accounts.filter((a) => a.status === "connected")
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
                  <button type="button"
                    onClick={() => setPairs((prev) => prev.map((p) => p.id === pair.id ? { ...p, saved: false } : p))}
                    className="text-[11px] text-muted-foreground hover:text-foreground">
                    Edit
                  </button>
                )}
                {pairs.length > 1 && (
                  <button type="button"
                    onClick={() => setPairs((prev) => prev.filter((p) => p.id !== pair.id))}
                    className="text-[11px] text-muted-foreground hover:text-red-500">
                    Remove
                  </button>
                )}
              </div>
            </div>

            {pair.saved ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
                <div className="text-foreground">
                  <span className="font-medium">
                    {(() => { const a = accounts.find((x) => x.id === pair.accountId); return a ? (a.label || a.username) : "?" })()}
                  </span>{" "}
                  in <span className="font-medium">{pair.guildName || pair.guildId}</span>
                </div>
                {(() => {
                  const otherAccounts = connectedAccounts.filter((a) =>
                    a.id !== pair.accountId && !pairs.some((p) => p.accountId === a.id && p.guildId === pair.guildId)
                  )
                  if (otherAccounts.length === 0) return null
                  const verifiedMatches = otherAccounts.filter((a) => {
                    const g = guildsByAccount[a.id]
                    return Array.isArray(g) && g.some((gg) => gg.id === pair.guildId)
                  })
                  const unknownCount = otherAccounts.length - otherAccounts.filter((a) => Array.isArray(guildsByAccount[a.id])).length
                  const isChecking = checkingPairId === pair.id
                  const progress = checkProgress?.pairId === pair.id ? checkProgress : null
                  const result = checkResult?.pairId === pair.id ? checkResult : null
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
                            let g = guildsByAccount[acct.id]
                            if (!g) {
                              try { await onFetchGuildsForAccount(acct.id) } catch { /* skip */ }
                              g = guildsByAccount[acct.id]
                            }
                            const match = (g || []).find((gg) => gg.id === pair.guildId)
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
                        className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/25 disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Add every other connected account that's also in this server"
                      >
                        {isChecking
                          ? `Checking… ${progress?.done ?? 0}/${progress?.total ?? otherAccounts.length}`
                          : verifiedMatches.length > 0
                            ? `+ apply to ${verifiedMatches.length} other in this server`
                            : unknownCount > 0
                              ? `+ check ${unknownCount} other account${unknownCount === 1 ? "" : "s"}`
                              : "+ no other accounts in this server"}
                      </button>
                      {result && !isChecking && (
                        <span className={`text-[10px] ${result.added > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
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
                      setPairs((prev) => prev.map((p) =>
                        p.id === pair.id ? { ...p, accountId, guildId: "", guildName: undefined } : p
                      ))
                      if (accountId) void onFetchGuildsForAccount(accountId)
                    }}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-[12px] text-foreground"
                  >
                    <option value="">— pick an account —</option>
                    {connectedAccounts
                      .slice()
                      .sort((a, b) => (a.label || a.username || "").localeCompare(b.label || b.username || "", undefined, { sensitivity: "base" }))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label || a.username} (@{a.username})
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
                      setPairs((prev) => prev.map((p) =>
                        p.id === pair.id
                          ? { ...p, guildId, guildName: g?.name, approximateMemberCount: g?.approximateMemberCount ?? null }
                          : p
                      ))
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
                    onClick={() => setPairs((prev) => prev.map((p) => p.id === pair.id ? { ...p, saved: true } : p))}
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
        onClick={() => setPairs((prev) => [...prev, { id: uid(), accountId: "", guildId: "", saved: false }])}
        className="w-full rounded-md border border-dashed border-input px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        + Add another pair (different account or server)
      </button>

      <p className="text-[11px] text-muted-foreground/80">
        Pair an account with a server it's already in — members of that server become FR leads.
      </p>
    </div>
  )
}
