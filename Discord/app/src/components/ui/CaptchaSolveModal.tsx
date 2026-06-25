import { useState, useEffect, useRef } from "react"
import HCaptcha from "@hcaptcha/react-hcaptcha"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog"

export interface CaptchaChallenge {
  sitekey: string
  rqdata?: string
  rqtoken?: string
}

export function CaptchaSolveModal({
  open,
  challenge,
  title,
  description,
  submitting,
  onSolved,
  onError,
  onClose,
}: {
  open: boolean
  challenge: CaptchaChallenge | null
  title?: string
  description?: string
  submitting?: boolean
  onSolved: (token: string) => void
  onError?: (err: unknown) => void
  onClose: () => void
}) {
  const ref = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open) { setLoaded(false); return }
  }, [open])

  useEffect(() => {
    if (!loaded || !challenge?.sitekey) return
    try {
      ref.current?.execute({ rqdata: challenge.rqdata, sitekey: challenge.sitekey })
    } catch (err) {
      onError?.(err)
    }
  }, [loaded, challenge?.sitekey, challenge?.rqdata, onError])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title ?? "Discord CAPTCHA Required"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <p className="text-sm text-text-muted text-center">
            {description ?? "Discord is asking you to prove you're human. A challenge window will pop in a moment."}
          </p>
          <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-bg-tertiary bg-bg-secondary">
            {submitting ? (
              <Loader2 className="h-8 w-8 animate-spin text-brand" />
            ) : (
              <p className="px-3 text-center text-xs text-text-muted">
                {loaded ? "Waiting for challenge…" : "Loading…"}
              </p>
            )}
          </div>
          {challenge && (
            <HCaptcha
              ref={ref}
              sitekey={challenge.sitekey}
              size="invisible"
              theme="dark"
              onLoad={() => setLoaded(true)}
              onVerify={(token) => onSolved(token)}
              onError={(err) => onError?.(err)}
              onExpire={() => onError?.("captcha expired — solve again")}
            />
          )}
          <p className="text-[11px] text-text-muted/60 text-center max-w-[280px]">
            This is Discord's anti-abuse challenge — same as what real users see.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
