import { useState, useEffect, useRef } from "react"
import { QRCodeSVG } from "qrcode.react"
import HCaptcha from "@hcaptcha/react-hcaptcha"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Loader2, KeyRound, QrCode, Sparkles, CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react"
import type { DiscordAccount, QrUserPreview, RealtimeEvent } from "@/api-types"

interface AddAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (account: DiscordAccount) => void
}

type Tab = "demo" | "token" | "qr"

export default function AddAccountModal({
  open,
  onOpenChange,
  onCreated,
}: AddAccountModalProps) {
  const [tab, setTab] = useState<Tab>("demo")
  const [label, setLabel] = useState("")
  const [username, setUsername] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) {
      setLabel("")
      setUsername("")
      setError("")
      setSubmitting(false)
      setTab("demo")
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError("")

    try {
      const body: { label: string; username?: string } = {
        label: label.trim() || "New Discord account",
      }
      const trimmedUsername = username.trim()
      if (trimmedUsername) body.username = trimmedUsername

      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`)
      }

      const created = (await res.json()) as DiscordAccount
      onCreated(created)
      onOpenChange(false)
    } catch (err) {
      console.error("Failed to create account", err)
      setError(
        err instanceof Error
          ? err.message
          : "Could not reach the demo backend.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-bg-tertiary bg-bg-secondary text-text-normal sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-text-normal">Add Discord account</DialogTitle>
          <DialogDescription className="text-text-muted">
            In demo mode every new account is simulated — no Discord
            credentials leave your browser.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList className="grid w-full grid-cols-3 border-bg-tertiary bg-bg-tertiary p-1 text-text-muted">
            <TabsTrigger
              value="demo"
              className="data-[state=active]:bg-bg-floating data-[state=active]:text-text-normal"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Demo
            </TabsTrigger>
            <TabsTrigger
              value="token"
              className="data-[state=active]:bg-bg-floating data-[state=active]:text-text-normal"
            >
              <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Token
            </TabsTrigger>
            <TabsTrigger
              value="qr"
              className="data-[state=active]:bg-bg-floating data-[state=active]:text-text-normal"
            >
              <QrCode className="mr-1.5 h-3.5 w-3.5" /> QR
            </TabsTrigger>
          </TabsList>

          <TabsContent value="demo" className="mt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Label
                </label>
                <Input
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Outreach 03"
                  className="border-bg-tertiary bg-bg-tertiary text-text-normal placeholder:text-text-muted focus-visible:ring-brand"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Discord username
                  <span className="ml-1 font-normal lowercase text-text-muted/80">
                    (optional in demo)
                  </span>
                </label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="auto-generated if blank"
                  className="border-bg-tertiary bg-bg-tertiary text-text-normal placeholder:text-text-muted focus-visible:ring-brand"
                />
              </div>

              {error && (
                <p className="rounded-chip border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
                  {error}
                </p>
              )}

              <DialogFooter className="gap-2 sm:gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-chip px-3 py-2 text-sm text-text-muted transition-colors duration-100 hover:bg-bg-tertiary hover:text-text-normal"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors duration-100 hover:bg-brand-hover disabled:opacity-60"
                >
                  {submitting && (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  )}
                  Create demo account
                </button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="token" className="mt-4">
            <TokenLoginPanel
              onAuthorized={(acct) => {
                onCreated(acct)
                onOpenChange(false)
              }}
            />
          </TabsContent>

          <TabsContent value="qr" className="mt-4">
            <QrLoginPanel
              active={tab === "qr" && open}
              onAuthorized={(acct) => {
                onCreated(acct)
                onOpenChange(false)
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// -----------------------------------------------------------------------------
// CaptchaSolveStep — renders the hCaptcha widget in ENTERPRISE mode.
//
// Why this exists as its own component: the @hcaptcha/react-hcaptcha widget
// only binds `rqdata` to its solve when execute() is called imperatively
// AFTER the widget loads. Passing rqdata as a render prop alone does not work
// for enterprise sitekeys — the resulting h-captcha-response token is treated
// as "invalid-response" by Discord because it has no rqdata binding.
//
// We use size="invisible" so execute() triggers the challenge modal
// automatically (and we don't show a no-op "I am human" checkbox that
// produces tokens Discord rejects).
// -----------------------------------------------------------------------------

function CaptchaSolveStep({
  captcha,
  username,
  submitting,
  onSolved,
  onWidgetError,
}: {
  captcha: CaptchaPrompt
  username: string | undefined
  submitting: boolean
  onSolved: (token: string) => void
  onWidgetError: (err: unknown) => void
}) {
  const ref = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)

  // As soon as the hCaptcha JS finishes loading, fire execute() with rqdata.
  // This is the call that puts the widget in enterprise mode.
  useEffect(() => {
    if (!loaded) return
    const widget = ref.current
    if (!widget) return
    try {
      widget.execute({ rqdata: captcha.rqdata, sitekey: captcha.sitekey })
    } catch (err) {
      onWidgetError(err)
    }
  }, [loaded, captcha.rqdata, captcha.sitekey, onWidgetError])

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-center">
        <p className="text-sm font-medium text-text-normal">
          Discord wants you to prove you're human
        </p>
        <p className="mt-1 max-w-[320px] text-xs text-text-muted">
          {username ? `Solving this for ${username}.` : ""} A challenge window
          should pop in a moment — solve it once and Discord issues the token.
        </p>
      </div>
      <div className="flex h-44 w-44 items-center justify-center rounded-card border border-bg-tertiary bg-bg-tertiary">
        {submitting ? (
          <Loader2 className="h-10 w-10 animate-spin text-brand" />
        ) : (
          <p className="px-3 text-center text-xs text-text-muted">
            {loaded ? "Waiting for hCaptcha challenge…" : "Loading challenge…"}
          </p>
        )}
      </div>
      {/* Invisible widget — solve UI pops in an overlay. */}
      <HCaptcha
        ref={ref}
        sitekey={captcha.sitekey}
        size="invisible"
        theme="dark"
        onLoad={() => setLoaded(true)}
        onVerify={(token) => onSolved(token)}
        onError={(err) => onWidgetError(err)}
        onExpire={() => onWidgetError("captcha expired — solve again")}
      />
      <p className="max-w-[320px] text-center text-[11px] text-text-muted/70">
        This is Discord's anti-abuse, not ours. The challenge is bound to
        Discord's rqdata — same flow beeper users see when their account is
        risk-flagged.
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------------
// QrLoginPanel — drives the real Discord remote-auth flow
// -----------------------------------------------------------------------------

// Mirrors discord-remote-auth.ts QrSessionStatus exactly so the modal can
// represent every server-side state, including the brief "authorizing" window
// during which we trade the ticket for an encrypted token over HTTP.
type QrStatus =
  | "idle"
  | "opening"
  | "waiting_scan"
  | "user_seen"
  | "authorizing"
  | "captcha_required"
  | "authorized"
  | "error"

interface CaptchaPrompt {
  sitekey: string
  rqdata: string
  service: string
}

function QrLoginPanel({
  active,
  onAuthorized,
}: {
  active: boolean
  onAuthorized: (acct: DiscordAccount) => void
}) {
  const [status, setStatus] = useState<QrStatus>("idle")
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [user, setUser] = useState<QrUserPreview | null>(null)
  const [error, setError] = useState<string>("")
  const [captcha, setCaptcha] = useState<CaptchaPrompt | null>(null)
  const [captchaSubmitting, setCaptchaSubmitting] = useState(false)
  const sessionRef = useRef<string | null>(null)

  const cancel = async () => {
    if (sessionRef.current) {
      try {
        await fetch(`/api/accounts/qr/${sessionRef.current}/cancel`, { method: "POST" })
      } catch {
        /* noop */
      }
    }
    sessionRef.current = null
    setStatus("idle")
    setQrUrl(null)
    setUser(null)
    setSessionId(null)
    setCaptcha(null)
    setCaptchaSubmitting(false)
  }

  // Open a session when this tab becomes active.
  useEffect(() => {
    if (!active) {
      cancel()
      return
    }
    let cancelled = false
    setStatus("opening")
    setError("")
    setQrUrl(null)
    setUser(null)
    fetch("/api/accounts/qr/start", { method: "POST" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`server returned ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        sessionRef.current = data.id
        setSessionId(data.id)
        if (data.qrUrl) {
          setQrUrl(data.qrUrl)
          setStatus("waiting_scan")
        }
      })
      .catch((err) => {
        if (cancelled) return
        setStatus("error")
        setError(err?.message || "failed to start QR session")
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Subscribe to SSE for this session.
  useEffect(() => {
    if (!sessionId) return
    // Backfill: in case qr_ready fired before this EventSource opened, pull current state once.
    fetch(`/api/accounts/qr/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        if (data.qrUrl && status === "opening") {
          setQrUrl(data.qrUrl)
          setStatus("waiting_scan")
        }
        if (data.userPreview) setUser(data.userPreview)
      })
      .catch(() => {})
    const es = new EventSource("/api/realtime")
    const handle = (e: MessageEvent) => {
      try {
        const evt: RealtimeEvent = JSON.parse(e.data)
        if (!("sessionId" in evt) || evt.sessionId !== sessionId) return
        if (evt.type === "qr_ready") {
          setQrUrl(evt.qrUrl)
          setStatus("waiting_scan")
        } else if (evt.type === "qr_user_seen") {
          setUser(evt.user)
          setStatus("user_seen")
        } else if (evt.type === "qr_authorizing") {
          setUser(evt.user)
          setStatus("authorizing")
        } else if (evt.type === "qr_captcha_required") {
          setUser(evt.user)
          setCaptcha({ sitekey: evt.sitekey, rqdata: evt.rqdata, service: evt.service })
          setStatus("captcha_required")
        } else if (evt.type === "qr_authorized") {
          setUser(evt.user)
          setStatus("authorized")
          // Pull the freshly created account record and bubble it up.
          fetch("/api/accounts")
            .then((r) => r.json())
            .then((list: DiscordAccount[]) => {
              const acct = list.find((a) => a.id === evt.accountId)
              if (acct) onAuthorized(acct)
            })
            .catch(() => {
              /* noop */
            })
        } else if (evt.type === "qr_failed") {
          setStatus("error")
          setError(evt.reason)
        } else if (evt.type === "qr_cancelled") {
          setStatus("idle")
        }
      } catch {
        /* ignore non-JSON heartbeats */
      }
    }
    es.addEventListener("qr_ready", handle as EventListener)
    es.addEventListener("qr_user_seen", handle as EventListener)
    es.addEventListener("qr_authorizing", handle as EventListener)
    es.addEventListener("qr_captcha_required", handle as EventListener)
    es.addEventListener("qr_authorized", handle as EventListener)
    es.addEventListener("qr_failed", handle as EventListener)
    es.addEventListener("qr_cancelled", handle as EventListener)
    return () => es.close()
  }, [sessionId, onAuthorized])

  // Cleanup on unmount
  useEffect(() => () => { void cancel() }, [])

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      {status === "opening" && (
        <>
          <div className="flex h-44 w-44 items-center justify-center rounded-card border border-bg-tertiary bg-bg-tertiary">
            <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
          </div>
          <p className="text-center text-xs text-text-muted">
            Opening connection to Discord…
          </p>
        </>
      )}

      {status === "waiting_scan" && qrUrl && (
        <>
          <div className="rounded-card bg-white p-3 shadow-md">
            <QRCodeSVG value={qrUrl} size={180} level="M" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-text-normal">Scan with your Discord mobile app</p>
            <p className="mt-1 text-xs text-text-muted">
              Open Discord → tap your avatar → <strong>Scan QR Code</strong>
            </p>
          </div>
          <p className="text-center text-[11px] text-text-muted/70">
            Code expires in 5 minutes
          </p>
        </>
      )}

      {status === "user_seen" && user && (
        <>
          <div className="flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-card border border-yellow/40 bg-bg-tertiary">
            <CheckCircle2 className="h-10 w-10 text-yellow" />
            <p className="text-center text-sm font-medium text-text-normal">
              {user.username}
            </p>
          </div>
          <div className="max-w-[300px] text-center">
            <p className="text-sm font-medium text-text-normal">
              Now tap <strong className="text-brand">Log in</strong> on your phone
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Discord is showing a "Are you sure you want to log in?" prompt — confirm there,
              not on this screen. You have ~2 minutes.
            </p>
          </div>
        </>
      )}

      {status === "authorizing" && user && (
        <>
          <div className="flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-card border border-brand/40 bg-bg-tertiary">
            <Loader2 className="h-10 w-10 animate-spin text-brand" />
            <p className="text-center text-sm font-medium text-text-normal">
              {user.username}
            </p>
          </div>
          <p className="text-center text-xs text-text-muted">
            Authorizing with Discord… (a few seconds)
          </p>
        </>
      )}

      {status === "captcha_required" && captcha && (
        <CaptchaSolveStep
          key={captcha.rqdata /* re-mount widget on new challenge so execute() re-runs */}
          captcha={captcha}
          username={user?.username}
          submitting={captchaSubmitting}
          onSolved={async (token) => {
            if (!sessionId) return
            setCaptchaSubmitting(true)
            try {
              const r = await fetch(`/api/accounts/qr/${sessionId}/captcha`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ captcha_key: token }),
              })
              const body = await r.json().catch(() => null)
              if (!r.ok && body?.status === "captcha_required") {
                setError("Discord rejected that solve — try the new challenge below")
                return
              }
              if (!r.ok) {
                setError(body?.error || `HTTP ${r.status}`)
                setStatus("error")
              }
            } catch (err) {
              setStatus("error")
              setError(err instanceof Error ? err.message : "captcha submit failed")
            } finally {
              setCaptchaSubmitting(false)
            }
          }}
          onWidgetError={(err) => {
            setStatus("error")
            setError(`hCaptcha error: ${String(err)}`)
          }}
        />
      )}

      {status === "authorized" && user && (
        <>
          <div className="flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-card border border-green/50 bg-bg-tertiary">
            <CheckCircle2 className="h-10 w-10 text-green" />
            <p className="text-center text-sm font-medium text-text-normal">
              Connected as<br />
              <strong>{user.username}</strong>
            </p>
          </div>
          <p className="text-center text-xs text-text-muted">
            Account added.
          </p>
        </>
      )}

      {status === "error" && (
        <>
          <div className="flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-card border border-red/40 bg-bg-tertiary">
            <AlertTriangle className="h-10 w-10 text-red" />
            <p className="px-3 text-center text-xs text-text-muted">
              {error || "Something went wrong"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setStatus("opening")
              setError("")
              fetch("/api/accounts/qr/start", { method: "POST" })
                .then((r) => r.json())
                .then((data) => {
                  sessionRef.current = data.id
                  setSessionId(data.id)
                  if (data.qrUrl) {
                    setQrUrl(data.qrUrl)
                    setStatus("waiting_scan")
                  }
                })
                .catch((err) => {
                  setStatus("error")
                  setError(err?.message || "retry failed")
                })
            }}
            className="rounded-card bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors duration-100 hover:bg-brand-hover"
          >
            Try again
          </button>
        </>
      )}

      <p className="mt-2 max-w-[260px] text-center text-[11px] text-text-muted/70">
        Connecting a Discord account this way uses the same protocol Discord's
        own desktop client uses for &ldquo;Scan to log in&rdquo;. It runs
        against Discord ToS for automation — use a throwaway account first.
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------------
// TokenLoginPanel — paste a Discord user token, we verify with /users/@me
// -----------------------------------------------------------------------------

function TokenLoginPanel({
  onAuthorized,
}: {
  onAuthorized: (acct: DiscordAccount) => void
}) {
  const [label, setLabel] = useState("")
  const [token, setToken] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [help, setHelp] = useState(false)
  const [bulkResults, setBulkResults] = useState<Array<{ tokenPreview: string; ok: boolean; username?: string; error?: string }> | null>(null)
  const [showCreds, setShowCreds] = useState(false)
  const [credEmail, setCredEmail] = useState("")
  const [credPassword, setCredPassword] = useState("")
  const [credTotp, setCredTotp] = useState("")
  const [showPw, setShowPw] = useState(false)

  // Auto-detect single vs multiple tokens by splitting on whitespace/newlines.
  const tokensFromInput = token
    .split(/[\r\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 30) // discord tokens are 50+ chars; this filters empty lines
  const isBulk = tokensFromInput.length > 1

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError("")
    setBulkResults(null)
    try {
      if (isBulk) {
        // Batch import — server verifies each one in sequence and reports per-token outcomes.
        const r = await fetch("/api/accounts/bulk-import-tokens", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokens: tokensFromInput, label: label.trim() }),
        })
        const body = await r.json().catch(() => null)
        if (!r.ok) {
          setError(body?.error || `HTTP ${r.status}`)
          return
        }
        setBulkResults(body.results || [])
        // If at least one succeeded, surface the first one to the parent so the modal closes
        // and refreshes the account list. The rest the parent picks up on its next fetch.
        const firstOk = (body.results || []).find((r: any) => r.ok)
        if (firstOk) {
          const accountsRes = await fetch("/api/accounts")
          const accounts = (await accountsRes.json().catch(() => [])) as DiscordAccount[]
          const created = accounts.find((a) => a.id === firstOk.accountId)
          if (created) onAuthorized(created)
        }
      } else {
        const r = await fetch("/api/accounts/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label: label.trim(), token: token.trim() }),
        })
        const body = await r.json().catch(() => null)
        if (!r.ok) {
          setError(body?.error || `HTTP ${r.status}`)
          return
        }
        const created = body as DiscordAccount
        if (showCreds && credPassword.trim()) {
          await fetch(`/api/accounts/${created.id}/credentials`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: credEmail.trim() || undefined,
              password: credPassword.trim(),
              totpSecret: credTotp.trim() || undefined,
            }),
          }).catch(() => {})
        }
        onAuthorized(created)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Label (optional)
        </label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Main account"
          className="border-bg-tertiary bg-bg-tertiary text-text-normal placeholder:text-text-muted focus-visible:ring-brand"
        />
      </div>
      <div className="space-y-1.5">
        <label className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-text-muted">
          <span>Discord user token{tokensFromInput.length > 1 ? "s" : ""}</span>
          {tokensFromInput.length > 0 && (
            <span className="font-mono text-text-normal">
              {tokensFromInput.length} token{tokensFromInput.length === 1 ? "" : "s"} detected
            </span>
          )}
        </label>
        <textarea
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="One token per line — paste many to import in bulk.&#10;mfa.XXXXXXXXXXXX…&#10;ABC.DEF.GHI&#10;…"
          spellCheck={false}
          autoComplete="off"
          className="min-h-[120px] w-full rounded-card border border-bg-tertiary bg-bg-tertiary px-3 py-2 font-mono text-xs text-text-normal placeholder:text-text-muted focus:border-brand focus:outline-none"
        />
      </div>

      {bulkResults && (
        <div className="space-y-1.5 rounded-chip border border-bg-tertiary bg-bg-floating p-2.5">
          <div className="text-[11px] font-semibold text-text-normal">
            Bulk import — {bulkResults.filter((r) => r.ok).length}/{bulkResults.length} succeeded
          </div>
          <ul className="max-h-[140px] space-y-0.5 overflow-y-auto text-[11px] font-mono">
            {bulkResults.map((r, i) => (
              <li key={i} className={r.ok ? "text-green" : "text-red"}>
                {r.ok ? "✓" : "✗"} {r.tokenPreview}{" "}
                {r.ok ? r.username : <span className="text-text-muted">— {r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Optional stored credentials */}
      <div className="rounded-card border border-bg-tertiary bg-bg-floating">
        <button
          type="button"
          onClick={() => setShowCreds((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-[11px] font-semibold text-text-muted hover:text-text-normal"
        >
          <span className="flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" />
            Save credentials
            <span className="font-normal text-text-muted/70">(optional)</span>
          </span>
          <span>{showCreds ? "▲" : "▼"}</span>
        </button>
        {showCreds && (
          <div className="space-y-2.5 border-t border-bg-tertiary px-3 pb-3 pt-2.5">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Email</label>
              <input
                type="email"
                value={credEmail}
                onChange={(e) => setCredEmail(e.target.value)}
                placeholder="account@example.com"
                className="w-full rounded-card border border-bg-tertiary bg-bg-tertiary px-3 py-1.5 text-xs text-text-normal placeholder:text-text-muted focus:border-brand focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={credPassword}
                  onChange={(e) => setCredPassword(e.target.value)}
                  placeholder="Discord account password"
                  className="w-full rounded-card border border-bg-tertiary bg-bg-tertiary px-3 py-1.5 pr-8 text-xs text-text-normal placeholder:text-text-muted focus:border-brand focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-normal"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                2FA secret <span className="font-normal lowercase text-text-muted/70">(optional)</span>
              </label>
              <input
                value={credTotp}
                onChange={(e) => setCredTotp(e.target.value)}
                placeholder="Base32 TOTP seed — skip if no 2FA"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-card border border-bg-tertiary bg-bg-tertiary px-3 py-1.5 font-mono text-xs text-text-normal placeholder:text-text-muted focus:border-brand focus:outline-none"
              />
            </div>
            <p className="text-[10px] text-text-muted/70">
              Stored encrypted. If the token is revoked, we'll log back in automatically to get a fresh one.
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setHelp((v) => !v)}
        className="text-left text-[11px] text-text-link underline decoration-dotted underline-offset-2 hover:opacity-80"
      >
        {help ? "Hide" : "How do I get my token?"}
      </button>
      {help && (
        <div className="space-y-2 rounded-chip border border-bg-tertiary bg-bg-floating px-3 py-2.5 text-[11px] leading-relaxed text-text-muted">
          <p className="font-medium text-text-normal">Fastest: from your already-open Discord browser tab</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>Open <code className="rounded bg-bg-tertiary px-1">discord.com</code> in Chrome/Brave/Edge → log in as the account you want.</li>
            <li>Press <kbd>F12</kbd> → click the <strong>Network</strong> tab.</li>
            <li>Click any conversation/server (triggers a request) — or just hit <kbd>F5</kbd>.</li>
            <li>In the request list, click any URL starting with <code className="rounded bg-bg-tertiary px-1">/api/v9/</code>.</li>
            <li>Scroll the right panel to <strong>Request Headers</strong> → find <code className="rounded bg-bg-tertiary px-1">authorization</code> → copy the value after the colon.</li>
            <li>Paste it above and hit <strong>Connect account</strong>.</li>
          </ol>
          <p className="pt-1 font-medium text-text-normal">Bulk: re-onboarding multiple accounts</p>
          <p className="pl-1">
            Do the same for each account, paste tokens <strong>one per line</strong> in the box above.
            We verify each in sequence and create one account per valid token.
          </p>
          <p className="pt-1 italic text-text-muted/80">
            Tokens give full account access — paste only your own. Discord rotates the token if you log out and back in, so save a fresh one when re-onboarding.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-chip border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting || !token.trim()}
          className="inline-flex items-center justify-center rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors duration-100 hover:bg-brand-hover disabled:opacity-60"
        >
          {submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {submitting
            ? (isBulk ? `Verifying ${tokensFromInput.length} tokens…` : "Verifying with Discord…")
            : (isBulk ? `Connect ${tokensFromInput.length} accounts` : "Connect account")}
        </button>
      </div>

      <p className="pt-1 text-[11px] text-text-muted/70">
        We verify the token by calling Discord's <code>/users/@me</code>. No captcha,
        no QR. If Discord 401s, the token is bad — generate a new one by logging
        out and back into Discord, then paste the fresh one.
      </p>
    </form>
  )
}
