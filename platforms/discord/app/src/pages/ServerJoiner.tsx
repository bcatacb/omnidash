import { useCallback, useEffect, useMemo, useState } from "react"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useConfirm, useNotify } from "@/components/ui/confirm"
import { CheckCircle2, ChevronRight, Globe, Pause, Play, Plus, RefreshCw, Trash2, Users, X, Zap } from "lucide-react"
import type { DiscordAccount, InvitePreview, JoinCampaign, JoinQueueRow, SavedInviteGroup } from "@/api-types"

// ─── Account tier (decoded from Discord snowflake) ────────────────────────────

function accountTier(discordUserId: string | null | undefined): {
  label: string; color: string; ageDays: number | null;
} {
  if (!discordUserId) return { label: "?", color: "text-muted-foreground", ageDays: null }
  try {
    const EPOCH = 1420070400000n
    const ms = Number((BigInt(discordUserId) >> 22n) + EPOCH)
    const ageDays = (Date.now() - ms) / 86_400_000
    if (ageDays < 14)  return { label: "Fresh",    color: "text-red",          ageDays }
    if (ageDays < 45)  return { label: "Young",    color: "text-amber-500",    ageDays }
    if (ageDays < 120) return { label: "Active",   color: "text-yellow-400",   ageDays }
    if (ageDays < 180) return { label: "Seasoned", color: "text-emerald-400",  ageDays }
    return               { label: "Veteran",  color: "text-brand",        ageDays }
  } catch {
    return { label: "?", color: "text-muted-foreground", ageDays: null }
  }
}

function guildIconUrl(guildId: string, icon: string | null) {
  if (!icon) return null
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=64`
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function fmtRel(iso: string | null) {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) {
    const pos = -diff
    if (pos < 3_600_000) return `in ${Math.round(pos / 60_000)}m`
    if (pos < 86_400_000) return `in ${Math.round(pos / 3_600_000)}h`
    return `in ${Math.round(pos / 86_400_000)}d`
  }
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

// ─── Invite resolver helper ───────────────────────────────────────────────────

async function resolveInvite(raw: string): Promise<InvitePreview> {
  const code = raw.trim().replace(/^https?:\/\/(www\.)?(discord\.(gg|com\/invite))\//i, "").split(/[/?&#]/)[0]
  const r = await fetch(`/api/invite-info?code=${encodeURIComponent(code)}`, {
    headers: { accept: "application/json" },
  })
  const text = await r.text()
  let j: any
  try { j = JSON.parse(text) } catch {
    throw new Error(r.ok ? "API returned non-JSON response" : `API ${r.status} — redeploy may be needed`)
  }
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j as InvitePreview
}

// ─── Create Wizard ────────────────────────────────────────────────────────────

function CreateWizard({
  accounts,
  onClose,
  onCreated,
  onGroupSaved,
}: {
  accounts: DiscordAccount[]
  onClose: () => void
  onCreated: () => void
  onGroupSaved?: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Step 1
  const [rawCodes, setRawCodes] = useState("")
  const [previews, setPreviews] = useState<InvitePreview[]>([])
  const [previewErrors, setPreviewErrors] = useState<string[]>([])
  const [resolving, setResolving] = useState(false)
  const [alreadyInGuild, setAlreadyInGuild] = useState<Set<string>>(new Set())

  // Step 2
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Step 3
  const [joinsPerDay, setJoinsPerDay] = useState(15)
  const [minAgeDays, setMinAgeDays] = useState(0)
  const [postAction, setPostAction] = useState<"browse" | "outreach" | "none">("browse")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Saved groups
  const [savedGroups, setSavedGroups] = useState<SavedInviteGroup[]>([])
  const [saveGroupName, setSaveGroupName] = useState("")

  const guild = previews[0] ?? null
  const codes = previews.map((p) => p.code)
  const daysNeeded = selectedIds.size > 0 ? Math.ceil(selectedIds.size / joinsPerDay) : 0

  // Eligible accounts: connected, not scraper decoy, meets min age
  const eligible = useMemo(() => {
    return accounts.filter((a) => {
      if (a.status !== "connected") return false
      if (a.isScraperDecoy) return false
      if (minAgeDays > 0) {
        const tier = accountTier(a.discordUserId)
        if (tier.ageDays !== null && tier.ageDays < minAgeDays) return false
      }
      return true
    })
  }, [accounts, minAgeDays])

  useEffect(() => {
    fetch("/api/saved-invite-groups")
      .then((r) => r.json())
      .then(setSavedGroups)
      .catch(() => {})
  }, [])

  const resolveAll = async () => {
    const lines = rawCodes.split(/\n|,/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return
    setResolving(true)
    setPreviews([]); setPreviewErrors([])
    const results = await Promise.allSettled(lines.map(resolveInvite))
    const ok: InvitePreview[] = []
    const errs: string[] = []
    results.forEach((r, i) => {
      if (r.status === "fulfilled") ok.push(r.value)
      else errs.push(`${lines[i]}: ${r.reason?.message || "failed"}`)
    })
    // Dedupe by guildId — all codes should point to the same guild
    const uniqueGuilds = new Set(ok.map((p) => p.guildId))
    if (uniqueGuilds.size > 1) errs.push("⚠ codes point to different servers — use codes from ONE server only")
    setPreviews(ok); setPreviewErrors(errs)

    // Check which accounts are already in the guild
    if (ok.length > 0) {
      fetch(`/api/guild-member-accounts?guild_id=${ok[0].guildId}`)
        .then((r) => r.json())
        .then((j) => {
          const ids = new Set<string>(Array.isArray(j.accountIds) ? j.accountIds : [])
          setAlreadyInGuild(ids)
          // Default: all eligible accounts NOT already in guild
          setSelectedIds(new Set(
            accounts
              .filter((a) => a.status === "connected" && !a.isScraperDecoy && !ids.has(a.id))
              .map((a) => a.id)
          ))
        })
        .catch(() => {})
    }
    setResolving(false)
  }

  function loadSavedGroup(group: SavedInviteGroup) {
    setRawCodes(group.codes.join("\n"))
    setSaveGroupName("") // clear save name
    // auto-resolve
    setTimeout(() => resolveAll(), 0)
  }

  async function saveCurrentAsGroup() {
    if (!guild || !saveGroupName.trim() || codes.length === 0) return
    try {
      await fetch("/api/saved-invite-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: saveGroupName.trim(),
          guild_id: guild.guildId,
          guild_name: guild.guildName,
          guild_icon: guild.guildIcon,
          codes,
        }),
      })
      const gs = await fetch("/api/saved-invite-groups").then((r) => r.json())
      setSavedGroups(gs)
      setSaveGroupName("")
      onGroupSaved?.()
      // no alert, immediate save
    } catch (e: any) {
      await notify({ title: "Failed to save", description: String(e?.message || e), variant: "error" })
    }
  }

  const submit = async () => {
    if (!guild || selectedIds.size === 0 || codes.length === 0) return
    setSubmitting(true); setSubmitError(null)
    try {
      const r = await fetch("/api/join-campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guild_id: guild.guildId,
          guild_name: guild.guildName,
          guild_icon: guild.guildIcon,
          invite_codes: codes,
          joins_per_day: joinsPerDay,
          min_account_age_days: minAgeDays,
          post_join_action: postAction,
          account_ids: [...selectedIds],
        }),
      })
      if (!r.ok) throw new Error((await r.json())?.error || `HTTP ${r.status}`)
      onCreated()
      onClose()
    } catch (e: any) {
      setSubmitError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-bg-tertiary bg-bg-secondary shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-bg-tertiary shrink-0">
          <div>
            <h2 className="text-base font-semibold">New join campaign</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Step {step} of 3 — {step === 1 ? "Invite codes" : step === 2 ? "Account selection" : "Settings"}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Step 1 — Invite codes */}
          {step === 1 && (
            <>
              {/* Saved groups */}
              {savedGroups.length > 0 && (
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Load saved group</label>
                  <div className="flex gap-2 flex-wrap">
                    {savedGroups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => loadSavedGroup(g)}
                        className="text-[11px] px-2 py-1 rounded border border-bg-tertiary hover:bg-bg-tertiary"
                        title={`${g.codes.length} codes for ${g.guild_name || g.guild_id}`}
                      >
                        {g.name} ({g.codes.length})
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">Or paste new codes below.</p>
                </div>
              )}

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Invite URLs — one per line (paste 10–20+ codes from different channels/roles)
                </label>
                <textarea
                  value={rawCodes}
                  onChange={(e) => setRawCodes(e.target.value)}
                  rows={6}
                  placeholder={"https://discord.gg/abc123\nhttps://discord.gg/def456\nhttps://discord.gg/ghi789"}
                  className="w-full rounded-md border border-input bg-bg-tertiary px-3 py-2 text-[12px] font-mono text-text-normal placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand resize-none"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  More codes = lower per-code velocity = safer. All codes must point to the <strong>same server</strong>.
                </p>
              </div>
              <Button onClick={resolveAll} disabled={resolving || !rawCodes.trim()}>
                {resolving ? "Resolving…" : "Verify codes"}
              </Button>
              {previewErrors.length > 0 && (
                <div className="space-y-1">
                  {previewErrors.map((e, i) => <p key={i} className="text-[11px] text-red">{e}</p>)}
                </div>
              )}
              {previews.length > 0 && previews[0] && (
                <div className="rounded-card border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-4">
                  {guildIconUrl(previews[0].guildId, previews[0].guildIcon) ? (
                    <img src={guildIconUrl(previews[0].guildId, previews[0].guildIcon)!} alt="" className="h-12 w-12 rounded-full" />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-brand/20 flex items-center justify-center text-brand font-bold">{previews[0].guildName[0]}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-normal truncate">{previews[0].guildName}</p>
                    <p className="text-[11px] text-muted-foreground">{previews[0].approximateMemberCount.toLocaleString()} members · {previews.length} invite code{previews.length !== 1 ? "s" : ""} verified</p>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                </div>
              )}

              {/* Save as group */}
              {previews.length > 0 && guild && (
                <div className="flex gap-2 items-center">
                  <Input
                    placeholder="Group name (e.g. Mucky Rivers - main)"
                    value={saveGroupName}
                    onChange={(e) => setSaveGroupName(e.target.value)}
                    className="text-[12px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={saveCurrentAsGroup}
                    disabled={!saveGroupName.trim()}
                  >
                    Save group
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Step 2 — Account picker */}
          {step === 2 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-text-normal">
                  <span className="font-semibold">{selectedIds.size}</span> / {eligible.length} eligible accounts selected
                  {alreadyInGuild.size > 0 && <span className="ml-2 text-muted-foreground">({alreadyInGuild.size} already members, excluded)</span>}
                </p>
                <div className="flex gap-2 text-[11px]">
                  <button type="button" className="text-brand hover:underline"
                    onClick={() => setSelectedIds(new Set(eligible.filter((a) => !alreadyInGuild.has(a.id)).map((a) => a.id)))}>
                    All
                  </button>
                  <button type="button" className="text-muted-foreground hover:underline"
                    onClick={() => setSelectedIds(new Set())}>
                    None
                  </button>
                </div>
              </div>

              {/* Tier legend */}
              <div className="flex flex-wrap gap-3 text-[10px]">
                {[
                  { label: "Fresh",    color: "text-red",         desc: "< 14 days" },
                  { label: "Young",    color: "text-amber-500",   desc: "14–45 days" },
                  { label: "Active",   color: "text-yellow-400",  desc: "45–120 days" },
                  { label: "Seasoned", color: "text-emerald-400", desc: "120–180 days" },
                  { label: "Veteran",  color: "text-brand",       desc: "> 180 days" },
                ].map((t) => (
                  <span key={t.label} className={`${t.color} font-semibold`}>{t.label} <span className="text-muted-foreground font-normal">({t.desc})</span></span>
                ))}
              </div>

              <div className="rounded-card border border-bg-tertiary overflow-hidden max-h-80 overflow-y-auto">
                {eligible.length === 0 ? (
                  <p className="px-3 py-4 text-[12px] text-muted-foreground text-center">No connected accounts available.</p>
                ) : (
                  <table className="w-full text-[12px]">
                    <tbody>
                      {eligible.map((a) => {
                        const checked = selectedIds.has(a.id)
                        const inGuild = alreadyInGuild.has(a.id)
                        const tier = accountTier(a.discordUserId)
                        return (
                          <tr key={a.id}
                            className={`border-b border-bg-tertiary/50 ${inGuild ? "opacity-40" : "hover:bg-bg-tertiary/20 cursor-pointer"} ${checked ? "bg-brand/5" : ""}`}
                            onClick={() => {
                              if (inGuild) return
                              setSelectedIds((prev) => {
                                const next = new Set(prev)
                                next.has(a.id) ? next.delete(a.id) : next.add(a.id)
                                return next
                              })
                            }}>
                            <td className="px-3 py-2 w-8">
                              <input type="checkbox" checked={checked && !inGuild} disabled={inGuild} readOnly
                                className="h-3.5 w-3.5 rounded border-input accent-brand" />
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-medium text-text-normal">{a.label || a.username}</span>
                              <span className="ml-1.5 text-muted-foreground">@{a.username}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`text-[10px] font-semibold ${tier.color}`}>{tier.label}</span>
                              {tier.ageDays !== null && <span className="ml-1 text-muted-foreground text-[10px]">{Math.floor(tier.ageDays)}d</span>}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground text-[10px]">
                              {inGuild ? "already member" : ""}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {/* Step 3 — Settings */}
          {step === 3 && guild && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Joins per day</label>
                  <Input type="number" value={joinsPerDay} min={1} max={200}
                    onChange={(e) => setJoinsPerDay(Math.max(1, Number(e.target.value)))} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Own server: 15–30 safe. External: 3–5.</p>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Min account age (days)</label>
                  <Input type="number" value={minAgeDays} min={0} max={365}
                    onChange={(e) => setMinAgeDays(Math.max(0, Number(e.target.value)))} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">0 = your server. 14+ = external.</p>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1.5 block">Post-join behaviour</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["browse", "outreach", "none"] as const).map((opt) => (
                    <button key={opt} type="button" onClick={() => setPostAction(opt)}
                      className={`rounded-md border py-2 text-[12px] font-medium transition-colors ${
                        postAction === opt ? "border-brand bg-brand/10 text-brand" : "border-input bg-bg-tertiary text-muted-foreground hover:text-text-normal"
                      }`}>
                      {opt === "browse" ? "Browse channels" : opt === "outreach" ? "Start outreach" : "Nothing"}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  {postAction === "browse" ? "Sends OP 14 channel reads 2–8 min after join (looks like a real new member opening the server)." :
                   postAction === "outreach" ? "Account feeds into DM campaigns after 2-day delay." :
                   "Account is added but takes no action after joining."}
                </p>
              </div>

              {/* Summary */}
              <div className="rounded-card border border-bg-tertiary bg-bg-tertiary/30 p-3 space-y-1 text-[11px]">
                <p className="font-semibold text-text-normal uppercase tracking-wide text-[10px] mb-2">Campaign summary</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-muted-foreground">Server</span>
                  <span className="font-medium text-text-normal">{guild.guildName}</span>
                  <span className="text-muted-foreground">Invite codes</span>
                  <span className="font-medium text-text-normal">{codes.length} codes</span>
                  <span className="text-muted-foreground">Accounts</span>
                  <span className="font-medium text-text-normal">{selectedIds.size}</span>
                  <span className="text-muted-foreground">Rate</span>
                  <span className="font-medium text-text-normal">{joinsPerDay}/day → ~{daysNeeded} day{daysNeeded !== 1 ? "s" : ""}</span>
                  <span className="text-muted-foreground">Per-code/day</span>
                  <span className={`font-medium ${codes.length > 0 && joinsPerDay / codes.length > 7 ? "text-amber-400" : "text-emerald-400"}`}>
                    ~{codes.length > 0 ? (joinsPerDay / codes.length).toFixed(1) : "?"} joins/code/day
                  </span>
                </div>
                {codes.length > 0 && joinsPerDay / codes.length > 7 && (
                  <p className="text-amber-400 text-[10px] mt-1">⚠ Add more invite codes to lower per-code velocity below 5/day.</p>
                )}
              </div>

              {submitError && <p className="text-[12px] text-red">{submitError}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-bg-tertiary flex justify-between shrink-0">
          <Button variant="outline" onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as 1 | 2 | 3)}>
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < 3 ? (
            <Button
              disabled={
                (step === 1 && previews.length === 0) ||
                (step === 2 && selectedIds.size === 0)
              }
              onClick={() => setStep((s) => (s + 1) as 2 | 3)}>
              Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={submitting || selectedIds.size === 0}>
              <Zap className="h-3.5 w-3.5" />
              {submitting ? "Creating…" : `Schedule ${selectedIds.size} joins`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Campaign Card ────────────────────────────────────────────────────────────

function CampaignCard({
  campaign,
  selected,
  onClick,
  onToggle,
  onDelete,
}: {
  campaign: JoinCampaign
  selected: boolean
  onClick: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const progress = campaign.total > 0 ? campaign.joined / campaign.total : 0
  const iconUrl = guildIconUrl(campaign.guild_id, campaign.guild_icon)

  const statusColor =
    campaign.status === "active" ? "bg-green text-green" :
    campaign.status === "paused" ? "bg-yellow-500 text-yellow-500" :
    "bg-muted-foreground text-muted-foreground"

  return (
    <div
      onClick={onClick}
      className={`rounded-card border p-4 cursor-pointer transition-colors ${
        selected ? "border-brand bg-brand/5" : "border-bg-tertiary bg-bg-secondary hover:bg-bg-message-hover"
      }`}
    >
      <div className="flex items-start gap-3">
        {iconUrl ? (
          <img src={iconUrl} alt="" className="h-10 w-10 rounded-full shrink-0" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-brand/20 flex items-center justify-center text-brand font-bold text-sm shrink-0">
            {(campaign.guild_name ?? "?")[0]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-text-normal truncate text-[13px]">{campaign.guild_name ?? campaign.guild_id}</p>
            <span className={`shrink-0 flex items-center gap-1 text-[10px] font-semibold ${statusColor.split(" ")[1]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusColor.split(" ")[0]}`} />
              {campaign.status}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">{campaign.invite_codes.length} codes · {campaign.joins_per_day}/day</p>

          {/* Progress bar */}
          <div className="mt-2 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="text-emerald-400 font-semibold">{campaign.joined} joined</span>
            <span>{campaign.pending} pending</span>
            {campaign.failed > 0 && <span className="text-red">{campaign.failed} failed</span>}
            <span className="ml-auto">{campaign.total} total</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" onClick={onToggle} className="text-[11px] h-7">
          {campaign.status === "active" ? <><Pause className="h-3 w-3" /> Pause</> : <><Play className="h-3 w-3" /> Resume</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="text-red hover:bg-red/10 hover:text-red h-7">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ─── Queue Detail Panel ───────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  pending:  "bg-bg-tertiary text-muted-foreground",
  joining:  "bg-yellow-500/10 text-yellow-400",
  joined:   "bg-emerald-500/10 text-emerald-400",
  failed:   "bg-red/10 text-red",
  skipped:  "bg-bg-tertiary text-muted-foreground",
}

function QueuePanel({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<JoinQueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/join-campaigns/${campaignId}/queue`, { cache: "no-cache" })
      const j = await r.json()
      setRows(Array.isArray(j) ? j : [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [campaignId])

  useEffect(() => { void load() }, [load])
  useAutoRefresh(load, 15_000)

  const filtered = filter ? rows.filter((r) => r.status === filter) : rows

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === "pending").length,
    joining: rows.filter((r) => r.status === "joining").length,
    joined: rows.filter((r) => r.status === "joined").length,
    failed: rows.filter((r) => r.status === "failed").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
  }), [rows])

  return (
    <div className="space-y-3">
      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {([["", "All"], ["pending", "Pending"], ["joined", "Joined"], ["failed", "Failed"], ["skipped", "Skipped"]] as const).map(([val, label]) => {
          const count = val === "" ? rows.length : counts[val as keyof typeof counts]
          return (
            <button key={val} type="button" onClick={() => setFilter(val)}
              className={`rounded-chip px-2 py-1 text-[11px] font-medium transition-colors ${
                filter === val ? "bg-brand text-white" : "bg-bg-tertiary text-muted-foreground hover:text-text-normal"
              }`}>
              {label} {count}
            </button>
          )
        })}
      </div>

      {loading ? (
        <p className="text-[12px] text-muted-foreground">Loading queue…</p>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No rows match.</p>
      ) : (
        <div className="rounded-card border border-bg-tertiary overflow-hidden max-h-[60vh] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-bg-tertiary bg-bg-tertiary/40">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Account</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Scheduled</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Code</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-b border-bg-tertiary/50 hover:bg-bg-tertiary/20">
                  <td className="px-3 py-2">
                    <span className="font-medium text-text-normal">{row.label || row.username || row.account_id.slice(0, 8)}</span>
                    {row.username && <span className="ml-1 text-muted-foreground">@{row.username}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-chip px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[row.status] ?? ""}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.status === "joined" ? fmtRel(row.joined_at) : fmtRel(row.scheduled_at)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground font-mono text-[10px]">
                    {row.invite_code}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">
                    {row.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ServerJoiner() {
  const [campaigns, setCampaigns] = useState<JoinCampaign[]>([])
  const [accounts, setAccounts] = useState<DiscordAccount[]>([])
  const [savedGroups, setSavedGroups] = useState<SavedInviteGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const confirm = useConfirm()
  const notify = useNotify()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, aRes, gRes] = await Promise.all([
        fetch("/api/join-campaigns", { cache: "no-cache" }),
        fetch("/api/accounts", { cache: "no-cache" }),
        fetch("/api/saved-invite-groups", { cache: "no-cache" }),
      ])
      const [cJson, aJson, gJson] = await Promise.all([cRes.json(), aRes.json(), gRes.json()])
      setCampaigns(Array.isArray(cJson) ? cJson : [])
      setAccounts(Array.isArray(aJson) ? aJson : [])
      setSavedGroups(Array.isArray(gJson) ? gJson : [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useAutoRefresh(refresh, 30_000)

  const selectedCampaign = campaigns.find((c) => c.id === selectedId) ?? null

  const toggleCampaign = async (c: JoinCampaign) => {
    const newStatus = c.status === "active" ? "paused" : "active"
    await fetch(`/api/join-campaigns/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    await refresh()
  }

  const deleteCampaign = async (c: JoinCampaign) => {
    const ok = await confirm({
      title: "Delete join campaign?",
      description: `This will remove all ${c.total} queued accounts for "${c.guild_name}". Accounts already joined remain in the server.`,
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!ok) return
    await fetch(`/api/join-campaigns/${c.id}`, { method: "DELETE" })
    if (selectedId === c.id) setSelectedId(null)
    await refresh()
  }

  const deleteSavedGroup = async (g: SavedInviteGroup) => {
    const ok = await confirm({
      title: `Delete saved group "${g.name}"?`,
      description: "The invite codes will no longer be available for quick loading.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!ok) return
    await fetch(`/api/saved-invite-groups/${g.id}`, { method: "DELETE" })
    await refresh()
  }

  return (
    <div className="p-6 max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Server Joiner</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Joins accounts to Discord servers over multiple days — naturally staggered, captcha auto-solved.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New campaign
          </Button>
        </div>
      </div>

      {/* Safety notice */}
      <div className="rounded-card border border-brand/20 bg-brand/5 px-4 py-3 text-[11px] text-muted-foreground">
        <strong className="text-text-normal">How it works:</strong> joins are spread across multiple days with random timing (never a burst). Each invite code is used ≤ {Math.ceil(15 / Math.max(1, campaigns[0]?.invite_codes?.length ?? 1))}/day. Captchas are auto-solved via 2captcha. After joining, accounts browse channels naturally.
      </div>

      {/* Saved Invite Groups */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-semibold">Saved Invite Groups</p>
          <p className="text-[10px] text-muted-foreground">Reusable per server</p>
        </div>
        {savedGroups.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No saved groups yet. Create one from the New Campaign wizard after verifying codes.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {savedGroups.map((g) => (
              <div key={g.id} className="rounded border border-bg-tertiary bg-bg-tertiary/30 px-3 py-1 text-[11px] flex items-center gap-2">
                <span className="font-medium">{g.name}</span>
                <span className="text-muted-foreground">({g.codes.length} codes for {g.guild_name || g.guild_id.slice(0,8)})</span>
                <button onClick={() => deleteSavedGroup(g)} className="text-red hover:text-red/80 ml-1">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {campaigns.length === 0 && !loading ? (
        <div className="rounded-md border border-dashed border-input p-8 text-center text-[12px] text-muted-foreground">
          No join campaigns yet. Click "New campaign" to get started.
        </div>
      ) : (
        <div className={`grid gap-4 ${selectedCampaign ? "grid-cols-[380px_1fr]" : "grid-cols-1 max-w-xl"}`}>
          {/* Campaign list */}
          <div className="space-y-3">
            {loading && <p className="text-[12px] text-muted-foreground">Loading…</p>}
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                selected={c.id === selectedId}
                onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                onToggle={() => toggleCampaign(c)}
                onDelete={() => deleteCampaign(c)}
              />
            ))}
          </div>

          {/* Detail panel */}
          {selectedCampaign && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {guildIconUrl(selectedCampaign.guild_id, selectedCampaign.guild_icon) ? (
                    <img src={guildIconUrl(selectedCampaign.guild_id, selectedCampaign.guild_icon)!} alt="" className="h-8 w-8 rounded-full" />
                  ) : null}
                  <div>
                    <p className="font-semibold text-text-normal">{selectedCampaign.guild_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {selectedCampaign.invite_codes.length} codes · {selectedCampaign.joins_per_day}/day · {selectedCampaign.post_join_action}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-center">
                  {[
                    { label: "Joined", value: selectedCampaign.joined, cls: "text-emerald-400" },
                    { label: "Pending", value: selectedCampaign.pending, cls: "text-text-normal" },
                    { label: "Failed", value: selectedCampaign.failed, cls: "text-red" },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className={`text-xl font-bold ${s.cls}`}>{s.value}</div>
                      <div className="text-[10px] text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <QueuePanel campaignId={selectedCampaign.id} />
            </div>
          )}
        </div>
      )}

      {creating && (
        <CreateWizard
          accounts={accounts}
          onClose={() => setCreating(false)}
          onCreated={refresh}
          onGroupSaved={refresh}
        />
      )}
    </div>
  )
}
