// v0.71.6 — In-app confirm/alert replacements for the browser-native dialogs.
//
// Use:
//   const confirm = useConfirm()
//   if (!await confirm({ title: "Delete proxy?", description: "...", variant: "danger" })) return
//
// Wrap your root once with <ConfirmProvider>...</ConfirmProvider> (already done
// in App.tsx). Each `confirm(opts)` call mounts a single modal and resolves the
// promise with true/false on the user's choice.
//
// `useNotify()` is the read-only counterpart for one-off info/error toasts —
// replaces window.alert(). It's modal too (not a toast) because we don't have
// a toast system yet, and modals at least feel intentional.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, Info, X } from "lucide-react"
import { Button } from "./button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog"

// ───── Types ─────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "danger"
}

export interface NotifyOptions {
  title: string
  description?: string
  variant?: "info" | "error" | "success"
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  notify: (opts: NotifyOptions) => Promise<void>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

// ───── Provider ──────────────────────────────────────────────────────────

interface PendingConfirm {
  kind: "confirm"
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}
interface PendingNotify {
  kind: "notify"
  opts: NotifyOptions
  resolve: () => void
}
type Pending = PendingConfirm | PendingNotify

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  // Use a ref for the resolver too so closing via X / escape resolves once.
  const resolvedRef = useRef(false)

  const confirm = useCallback((opts: ConfirmOptions) => {
    resolvedRef.current = false
    return new Promise<boolean>((resolve) => {
      setPending({ kind: "confirm", opts, resolve })
    })
  }, [])

  const notify = useCallback((opts: NotifyOptions) => {
    resolvedRef.current = false
    return new Promise<void>((resolve) => {
      setPending({ kind: "notify", opts, resolve })
    })
  }, [])

  const handleClose = useCallback((accepted: boolean) => {
    if (!pending || resolvedRef.current) return
    resolvedRef.current = true
    if (pending.kind === "confirm") pending.resolve(accepted)
    else pending.resolve()
    setPending(null)
  }, [pending])

  const value = useMemo(() => ({ confirm, notify }), [confirm, notify])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) handleClose(false)
        }}
      >
        {pending && (
          <DialogContent className="max-w-md border-bg-tertiary bg-bg-secondary text-text-normal">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {pending.kind === "confirm" && pending.opts.variant === "danger" && (
                  <AlertTriangle className="h-5 w-5 text-rose-500" />
                )}
                {pending.kind === "notify" && pending.opts.variant === "error" && (
                  <AlertTriangle className="h-5 w-5 text-rose-500" />
                )}
                {pending.kind === "notify" && (pending.opts.variant === "info" || !pending.opts.variant) && (
                  <Info className="h-5 w-5 text-brand" />
                )}
                {pending.opts.title}
              </DialogTitle>
              {pending.opts.description && (
                <DialogDescription className="text-text-muted whitespace-pre-wrap">
                  {pending.opts.description}
                </DialogDescription>
              )}
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              {pending.kind === "confirm" ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleClose(false)}
                  >
                    {pending.opts.cancelLabel || "Cancel"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleClose(true)}
                    className={
                      pending.opts.variant === "danger"
                        ? "bg-rose-600 text-white hover:bg-rose-700"
                        : ""
                    }
                  >
                    {pending.opts.confirmLabel || "Confirm"}
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => handleClose(true)}>
                  OK
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  )
}

// ───── Hooks ─────────────────────────────────────────────────────────────

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>")
  return ctx.confirm
}

export function useNotify() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error("useNotify must be used inside <ConfirmProvider>")
  return ctx.notify
}

// Suppress unused-import lint for the X icon — Dialog primitive provides its
// own close button; we just keep the import in case future variants need it.
void X
