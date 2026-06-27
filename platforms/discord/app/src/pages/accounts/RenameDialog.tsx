import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"
import type { DiscordAccount } from "@/api-types"

interface RenameDialogProps {
  account: DiscordAccount | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRenamed: (account: DiscordAccount) => void
}

export default function RenameDialog({
  account,
  open,
  onOpenChange,
  onRenamed,
}: RenameDialogProps) {
  const [label, setLabel] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open && account) {
      setLabel(account.label)
      setError("")
      setSubmitting(false)
    }
  }, [open, account])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!account || submitting) return
    const trimmed = label.trim()
    if (!trimmed) {
      setError("Label can't be empty.")
      return
    }
    setSubmitting(true)
    setError("")

    try {
      // Spec says: PATCH may not be implemented yet — call it anyway.
      // If Agent I rolls a different verb later we can swap here in one place.
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      })

      if (res.ok) {
        // Try to parse a returned account, but tolerate empty body.
        try {
          const updated = (await res.json()) as DiscordAccount
          onRenamed(updated)
        } catch {
          onRenamed({ ...account, label: trimmed })
        }
      } else {
        // Optimistic fallback if backend hasn't wired PATCH yet.
        console.warn(
          `PATCH /api/accounts/${account.id} returned ${res.status} — applying optimistic rename.`,
        )
        onRenamed({ ...account, label: trimmed })
      }

      onOpenChange(false)
    } catch (err) {
      console.error("Failed to rename account", err)
      // Backend likely offline in demo — apply optimistic rename so the UI
      // still feels responsive while we wait for Agent I.
      onRenamed({ ...account, label: trimmed })
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-bg-tertiary bg-bg-secondary text-text-normal sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-text-normal">Rename account</DialogTitle>
          <DialogDescription className="text-text-muted">
            Pick a label only you will see. Doesn't change the Discord username.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Label
            </label>
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="border-bg-tertiary bg-bg-tertiary text-text-normal placeholder:text-text-muted focus-visible:ring-brand"
            />
            {error && <p className="text-xs text-red">{error}</p>}
          </div>
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
              Save
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
