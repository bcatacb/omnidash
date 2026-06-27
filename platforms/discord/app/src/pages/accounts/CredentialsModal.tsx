import { useState } from "react"
import { Lock, Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { DiscordAccount } from "@/api-types"

interface CredentialsModalProps {
  account: DiscordAccount
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (accountId: string) => void
}

export default function CredentialsModal({ account, open, onOpenChange, onSaved }: CredentialsModalProps) {
  const [email, setEmail]           = useState(account.cachedEmail ?? "")
  const [password, setPassword]     = useState("")
  const [totpSecret, setTotpSecret] = useState("")
  const [showPw, setShowPw]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState("")
  const [saved, setSaved]           = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) { setError("Password is required"); return }
    setSubmitting(true)
    setError("")
    try {
      const r = await fetch(`/api/accounts/${account.id}/credentials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || undefined,
          password: password.trim(),
          totpSecret: totpSecret.trim() || undefined,
        }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setSaved(true)
      onSaved(account.id)
      setTimeout(() => onOpenChange(false), 1200)
    } catch (err: any) {
      setError(err?.message || "Failed to save credentials")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-bg-tertiary bg-bg-secondary text-text-normal sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text-normal">
            <Lock className="h-4 w-4 text-brand" />
            Save credentials — {account.label || account.username}
          </DialogTitle>
          <DialogDescription className="text-text-muted">
            Stored encrypted. Used to auto-fetch a fresh token if this account's token is revoked.
          </DialogDescription>
        </DialogHeader>

        {saved ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <CheckCircle2 className="h-8 w-8 text-green" />
            <p className="text-sm font-medium text-text-normal">Credentials saved</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Email
              </label>
              <Input
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="account@example.com"
                className="border-bg-tertiary bg-bg-tertiary text-text-normal placeholder:text-text-muted focus-visible:ring-brand"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Password
              </label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Discord account password"
                  className="border-bg-tertiary bg-bg-tertiary pr-9 text-text-normal placeholder:text-text-muted focus-visible:ring-brand"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-normal"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                2FA / TOTP secret
                <span className="ml-1 font-normal lowercase text-text-muted/70">(optional)</span>
              </label>
              <Input
                value={totpSecret}
                onChange={(e) => setTotpSecret(e.target.value)}
                placeholder="Base32 seed — e.g. JBSWY3DPEHPK3PXP"
                spellCheck={false}
                autoComplete="off"
                className="border-bg-tertiary bg-bg-tertiary font-mono text-xs text-text-normal placeholder:text-text-muted focus-visible:ring-brand"
              />
              <p className="text-[10px] text-text-muted/70">
                Find this when setting up 2FA in Discord ("can't scan? use this key").
                Leave blank if the account has no 2FA.
              </p>
            </div>

            {error && (
              <p className="rounded-chip border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-chip px-3 py-2 text-sm text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !password.trim()}
                className="inline-flex items-center gap-1.5 rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save credentials
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
