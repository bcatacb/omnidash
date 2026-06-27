import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DiscordAccount } from "@/api-types"

export default function AddAccountPicker({
  groupId, available, onClose, onAdded,
}: {
  groupId: string
  available: DiscordAccount[]
  onClose: () => void
  onAdded: () => void | Promise<void>
}) {
  const [adding, setAdding] = useState<string | null>(null)

  const add = async (accountId: string) => {
    setAdding(accountId)
    try {
      await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      })
      await onAdded()
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-card border border-bg-tertiary bg-bg-floating p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Add account to group</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">No more accounts available — every captured account is already in a group.</p>
        ) : (
          <ul className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {available.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2">
                <div>
                  <div className="text-[13px] font-medium">@{a.username}</div>
                  <div className="text-[10px] text-muted-foreground">{a.label || ""}</div>
                </div>
                <Button size="sm" disabled={adding === a.id} onClick={() => add(a.id)}>
                  {adding === a.id ? "Adding…" : "Add"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
