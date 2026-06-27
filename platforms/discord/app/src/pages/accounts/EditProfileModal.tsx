import { useEffect, useRef, useState } from "react"
import HCaptcha from "@hcaptcha/react-hcaptcha"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DiscordAccount } from "@/api-types"

interface CaptchaPrompt {
  sitekey: string
  rqdata: string
  rqtoken: string
  service: string
}

// v0.43 — Edit a captured account's Discord-side display name + avatar.
// Username changes are NOT supported here because Discord requires the
// account password for that path; we don't store passwords. See the
// PATCH /api/accounts/:id/profile route for the backend.

export default function EditProfileModal({
  account, existingNames = [], onClose, onSaved,
}: {
  account: DiscordAccount
  /** v0.47 — other accounts' display names, used to warn on duplicates. */
  existingNames?: string[]
  onClose: () => void
  onSaved: (updated: DiscordAccount) => void
}) {
  const [displayName, setDisplayName] = useState(account.label || account.username || "")
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(account.avatarUrl)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // v0.45 — captcha state. When Discord challenges, backend returns
  // { captcha: { sitekey, rqdata, rqtoken, service } }; we render the
  // hCaptcha widget here and retry the PATCH with the resulting token.
  const [captcha, setCaptcha] = useState<CaptchaPrompt | null>(null)
  const captchaRef = useRef<any>(null)
  const [captchaLoaded, setCaptchaLoaded] = useState(false)
  useEffect(() => {
    if (!captcha || !captchaLoaded || !captchaRef.current) return
    try {
      captchaRef.current.execute({ rqdata: captcha.rqdata, sitekey: captcha.sitekey })
    } catch (err: any) {
      setError(`captcha widget error: ${err?.message || err}`)
    }
  }, [captcha, captchaLoaded])

  // v0.47 — duplicate-name detection against every other account's display
  // name (case-insensitive, trimmed). Shows an inline warning under the input.
  const trimmedName = displayName.trim().toLowerCase()
  const isDuplicate = trimmedName.length > 0 && existingNames.some((n) => n.trim().toLowerCase() === trimmedName)

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (PNG, JPG, GIF).")
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Image must be under 8 MB.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || "")
      setAvatarDataUrl(result)
      setAvatarPreview(result)
      setError(null)
    }
    reader.onerror = () => setError("Failed to read the file.")
    reader.readAsDataURL(file)
  }

  // Fire the PATCH, optionally with a solved captcha token. On a captcha
  // challenge response, swap UI to the hCaptcha widget; on widget verify, this
  // function is called again with the resulting `captchaKey`.
  const submitPatch = async (captchaKey?: string, captchaRqtoken?: string) => {
    setSubmitting(true)
    setError(null)
    const trimmed = displayName.trim()
    const changedName = trimmed && trimmed !== (account.label || "")
    if (!changedName && !avatarDataUrl && !captchaKey) {
      setError("Nothing to update — change the name or pick a new image.")
      setSubmitting(false)
      return
    }
    try {
      const body: any = {}
      if (changedName) body.displayName = trimmed
      if (avatarDataUrl) body.avatarDataUrl = avatarDataUrl
      if (captchaKey) body.captchaKey = captchaKey
      if (captchaRqtoken) body.captchaRqtoken = captchaRqtoken
      const r = await fetch(`/api/accounts/${encodeURIComponent(account.id)}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (r.status === 400 && j?.captcha?.sitekey) {
        // Show the solve UI; the useEffect on `captcha` triggers execute().
        setCaptcha({
          sitekey: String(j.captcha.sitekey),
          rqdata: String(j.captcha.rqdata || ''),
          rqtoken: String(j.captcha.rqtoken || ''),
          service: String(j.captcha.service || 'hcaptcha'),
        })
        setCaptchaLoaded(false)
        setSubmitting(false)
        return
      }
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      onSaved(j as DiscordAccount)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }
  const save = () => submitPatch()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-card border border-bg-tertiary bg-bg-floating p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">Edit Discord profile</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Updates this account's display name + avatar on Discord. Handle (<code className="rounded bg-muted px-1">@{account.username}</code>) is not editable here.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium">Display name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
              placeholder="e.g. Mike from Toronto"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Up to 32 characters. Shows above messages in every DM this account sends.</p>
            {isDuplicate && (
              <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                ⚠ Another account already uses <strong>{displayName.trim()}</strong>. Saving will create a duplicate display name across your fleet.
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium">Avatar</label>
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 shrink-0 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="avatar preview" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">no avatar</span>
                )}
              </div>
              <div className="flex-1">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                  className="block w-full text-[12px] file:mr-2 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-white hover:file:bg-brand-hover"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">PNG/JPG/GIF/WebP, max 8 MB. Discord re-encodes large images.</p>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-200">
              {error}
            </div>
          )}

          {captcha && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[12px]">
              <p className="font-semibold text-amber-700 dark:text-amber-300">
                Discord wants a captcha solve for this profile change
              </p>
              <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/80">
                A challenge window should pop in a second. Solve it once and we'll resubmit automatically.
              </p>
              <HCaptcha
                ref={captchaRef}
                sitekey={captcha.sitekey}
                size="invisible"
                theme="dark"
                onLoad={() => setCaptchaLoaded(true)}
                onVerify={(token) => {
                  // Operator solved it — retry the PATCH with captchaKey + rqtoken.
                  setCaptcha(null)
                  void submitPatch(token, captcha.rqtoken)
                }}
                onError={(err) => {
                  setError(`captcha error: ${typeof err === 'string' ? err : 'widget rejected'}`)
                  setCaptcha(null)
                }}
                onExpire={() => {
                  setError("captcha expired — try again")
                  setCaptcha(null)
                }}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button onClick={save} disabled={submitting || !!captcha}>
              {submitting ? "Saving…" : captcha ? "Waiting for captcha…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
