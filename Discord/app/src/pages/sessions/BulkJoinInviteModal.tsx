import { useEffect, useRef, useState } from "react"
import HCaptcha from "@hcaptcha/react-hcaptcha"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { AccountGroupWithMembers, DiscordAccount } from "@/api-types"

// v0.46 — Bulk-join every member of a group to a Discord server via an invite
// link. Discord captcha-walls some accounts on join; when that happens we
// surface the hCaptcha widget for that specific account (same flow used by
// QR-login and profile-edit), the operator solves it, we retry just that
// account, then move on.

type RowStatus = "pending" | "joining" | "joined" | "captcha" | "failed"

interface RowState {
  accountId: string
  username: string
  status: RowStatus
  message?: string
  captcha?: { sitekey: string; rqdata: string; rqtoken: string; service: string }
}

interface CaptchaResponse {
  sitekey: string
  rqdata?: string
  rqtoken?: string
  service?: string
}

export default function BulkJoinInviteModal({
  group, accounts, onClose,
}: {
  group: AccountGroupWithMembers
  accounts: DiscordAccount[]
  onClose: () => void
}) {
  const [invite, setInvite] = useState("")
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<RowState[]>(() =>
    group.members
      .map((m) => accounts.find((a) => a.id === m.accountId))
      .filter((a): a is DiscordAccount => !!a)
      .map((a) => ({ accountId: a.id, username: a.username, status: "pending" as RowStatus })),
  )

  // Active captcha solve — only one at a time. Captures the rowIndex + the
  // prompt so the embedded HCaptcha widget can execute() with the right rqdata.
  const [activeCaptcha, setActiveCaptcha] = useState<{ rowIdx: number; sitekey: string; rqdata: string; rqtoken: string } | null>(null)
  const captchaRef = useRef<any>(null)
  const [captchaLoaded, setCaptchaLoaded] = useState(false)
  useEffect(() => {
    if (!activeCaptcha || !captchaLoaded || !captchaRef.current) return
    try {
      captchaRef.current.execute({ rqdata: activeCaptcha.rqdata, sitekey: activeCaptcha.sitekey })
    } catch (err) {
      // ignore — operator can dismiss + retry
      console.warn("[bulk-join] captcha execute() failed", err)
    }
  }, [activeCaptcha, captchaLoaded])

  // Try one account. Returns the next status. If captcha-required, also
  // stashes the prompt into the row so the operator can solve it.
  const tryJoin = async (rowIdx: number, captchaKey?: string, captchaRqtoken?: string) => {
    const row = rows[rowIdx]
    if (!row) return
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, status: "joining", message: undefined } : r)))
    try {
      const body: any = { invite }
      if (captchaKey) body.captchaKey = captchaKey
      if (captchaRqtoken) body.captchaRqtoken = captchaRqtoken
      const r = await fetch(`/api/accounts/${encodeURIComponent(row.accountId)}/join-invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j?.ok !== false) {
        setRows((prev) => prev.map((rr, i) => (i === rowIdx ? { ...rr, status: "joined", message: j?.guildName || "joined" } : rr)))
        return
      }
      // Captcha challenge?
      const captcha = (j?.captcha as CaptchaResponse | undefined) ?? null
      if (r.status === 400 && captcha?.sitekey) {
        setRows((prev) => prev.map((rr, i) => (i === rowIdx ? {
          ...rr,
          status: "captcha",
          message: "captcha required — click Solve",
          captcha: {
            sitekey: String(captcha.sitekey),
            rqdata: String(captcha.rqdata || ""),
            rqtoken: String(captcha.rqtoken || ""),
            service: String(captcha.service || "hcaptcha"),
          },
        } : rr)))
        return
      }
      const errMsg = (typeof j?.error === "string" ? j.error : `HTTP ${r.status}`).slice(0, 160)
      setRows((prev) => prev.map((rr, i) => (i === rowIdx ? { ...rr, status: "failed", message: errMsg } : rr)))
    } catch (err: any) {
      setRows((prev) => prev.map((rr, i) => (i === rowIdx ? { ...rr, status: "failed", message: err?.message || String(err) } : rr)))
    }
  }

  // Sequentially try every pending row. 2s spacing between attempts so a
  // single proxy IP doesn't burst-join 17 servers in 2 seconds.
  const runAll = async () => {
    const trimmed = invite.trim()
    if (!trimmed) return
    setRunning(true)
    for (let i = 0; i < rows.length; i += 1) {
      // re-read current status; operator might've solved captchas mid-run
      const cur = rowsRef.current[i]
      if (!cur) continue
      if (cur.status === "joined" || cur.status === "captcha") continue
      await tryJoin(i)
      await new Promise((res) => setTimeout(res, 2000))
    }
    setRunning(false)
  }

  // Mirror rows into a ref so the sequential loop sees the latest state.
  const rowsRef = useRef(rows)
  useEffect(() => { rowsRef.current = rows }, [rows])

  const openSolve = (rowIdx: number) => {
    const row = rows[rowIdx]
    if (!row?.captcha) return
    setActiveCaptcha({
      rowIdx,
      sitekey: row.captcha.sitekey,
      rqdata: row.captcha.rqdata,
      rqtoken: row.captcha.rqtoken,
    })
    setCaptchaLoaded(false)
  }

  const totals = {
    joined: rows.filter((r) => r.status === "joined").length,
    failed: rows.filter((r) => r.status === "failed").length,
    captcha: rows.filter((r) => r.status === "captcha").length,
    pending: rows.filter((r) => r.status === "pending" || r.status === "joining").length,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-card border border-bg-tertiary bg-bg-floating p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Add group to a server</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Joins every account in <strong>{group.name}</strong> ({rows.length}) to the same Discord server via an invite link.
              2s spacing between accounts. Captcha challenges surface inline — solve and we retry that account.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <Input
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="https://discord.gg/abc123  or  discord.gg/abc123  or  abc123"
            disabled={running}
          />
          <Button onClick={runAll} disabled={running || invite.trim().length === 0}>
            {running ? "Joining…" : "Start"}
          </Button>
        </div>

        <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {totals.joined} joined · {totals.failed} failed · {totals.captcha} need captcha · {totals.pending} pending
          </span>
          {totals.captcha > 0 && (
            <span className="text-amber-700 dark:text-amber-300">Solve any "captcha" row to retry that account</span>
          )}
        </div>

        <ul className="space-y-1 max-h-[50vh] overflow-y-auto rounded-md border border-input bg-background p-2 text-[12px]">
          {rows.map((row, idx) => (
            <li key={row.accountId} className="flex items-center justify-between gap-2 rounded px-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate font-medium">@{row.username}</div>
                {row.message && (
                  <div className={cn(
                    "truncate text-[10px]",
                    row.status === "joined" && "text-emerald-600 dark:text-emerald-400",
                    row.status === "failed" && "text-rose-600 dark:text-rose-400",
                    row.status === "captcha" && "text-amber-700 dark:text-amber-300",
                    (row.status === "pending" || row.status === "joining") && "text-muted-foreground",
                  )}>
                    {row.message}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {row.status === "joined" && <span className="text-emerald-600 dark:text-emerald-400">✓</span>}
                {row.status === "failed" && (
                  <Button size="sm" variant="ghost" onClick={() => tryJoin(idx)} className="h-7 text-[11px]">retry</Button>
                )}
                {row.status === "captcha" && (
                  <Button size="sm" onClick={() => openSolve(idx)} className="h-7 text-[11px]">Solve captcha</Button>
                )}
                {row.status === "joining" && <span className="text-muted-foreground text-[10px]">…</span>}
              </div>
            </li>
          ))}
        </ul>

        {activeCaptcha && (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[12px]">
            <p className="font-semibold text-amber-700 dark:text-amber-300">
              Solving captcha for @{rows[activeCaptcha.rowIdx]?.username}
            </p>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/80">
              A challenge window should pop in a second. We retry the join automatically once you solve it.
            </p>
            <HCaptcha
              ref={captchaRef}
              sitekey={activeCaptcha.sitekey}
              size="invisible"
              theme="dark"
              onLoad={() => setCaptchaLoaded(true)}
              onVerify={(token) => {
                const rowIdx = activeCaptcha.rowIdx
                const rqtoken = activeCaptcha.rqtoken
                setActiveCaptcha(null)
                void tryJoin(rowIdx, token, rqtoken)
              }}
              onError={() => {
                setRows((prev) => prev.map((rr, i) => (i === activeCaptcha.rowIdx ? { ...rr, status: "failed", message: "captcha error — try again" } : rr)))
                setActiveCaptcha(null)
              }}
              onExpire={() => {
                setRows((prev) => prev.map((rr, i) => (i === activeCaptcha.rowIdx ? { ...rr, status: "captcha", message: "captcha expired — solve again" } : rr)))
                setActiveCaptcha(null)
              }}
            />
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={running}>Close</Button>
        </div>
      </div>
    </div>
  )
}
