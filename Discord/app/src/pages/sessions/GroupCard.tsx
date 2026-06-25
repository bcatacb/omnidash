import { useState } from "react"
import { ChevronDown, ChevronRight, Globe, Plus, ServerCog, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AccountGroupWithMembers, DiscordAccount } from "@/api-types"
import AddAccountPicker from "./AddAccountPicker"
import BulkJoinInviteModal from "./BulkJoinInviteModal"

// Chrome extension id of the published GG extension. Until we publish to the
// Web Store, this is the ID of the sideloaded unpacked extension — which is
// derived from the public key in extension/manifest.json. The operator's
// install will print this id; we store it in localStorage for subsequent
// sessions. See extension/README.md for the install procedure.
const EXTENSION_ID_KEY = "gg-extension-id"

function activateAccount(groupId: string, accountId: string): { ok: boolean; reason?: string } {
  const extensionId = localStorage.getItem(EXTENSION_ID_KEY) || ""
  if (!extensionId) {
    return { ok: false, reason: "Extension not configured — see Setup instructions on this page." }
  }
  const sessionToken = localStorage.getItem("tg_saas_session") || ""
  const msg = { type: "activate", groupId, accountId, sessionToken }
  try {
    // Use chrome.runtime.sendMessage (externally_connectable) — works on
    // self-signed HTTPS pages where Chrome blocks content-script injection.
    const cr = (window as any).chrome?.runtime
    if (cr?.sendMessage) {
      cr.sendMessage(extensionId, msg, (response: any) => {
        if (cr.lastError) console.warn("[gg] activate failed:", cr.lastError.message)
        else console.log("[gg] activate ok:", response)
      })
      return { ok: true }
    }
    // Fallback: postMessage for content-script path.
    window.postMessage({ ...msg, type: "gg-activate" }, "*")
    return { ok: true }
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

export default function GroupCard({
  group, accounts, allGroups, onChange, onDelete,
}: {
  group: AccountGroupWithMembers
  accounts: DiscordAccount[]
  allGroups: AccountGroupWithMembers[]
  onChange: () => void | Promise<void>
  onDelete: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  // v0.46: groups default collapsed so the page is scannable with many groups.
  const [collapsed, setCollapsed] = useState(true)
  const [bulkJoinOpen, setBulkJoinOpen] = useState(false)
  const [activateStatus, setActivateStatus] = useState<Record<string, string>>({})
  const [guildsState, setGuildsState] = useState<Record<string, { open: boolean; loading: boolean; guilds: { id: string; name: string }[] | null }>>({})

  const toggleGuilds = async (accountId: string) => {
    const cur = guildsState[accountId]
    if (cur?.open) {
      setGuildsState((s) => ({ ...s, [accountId]: { ...s[accountId], open: false } }))
      return
    }
    setGuildsState((s) => ({ ...s, [accountId]: { open: true, loading: cur?.guilds == null, guilds: cur?.guilds ?? null } }))
    if (cur?.guilds != null) return
    try {
      const r = await fetch(`/api/accounts/${accountId}/guilds`)
      const j = r.ok ? await r.json() : { guilds: [] }
      setGuildsState((s) => ({ ...s, [accountId]: { open: true, loading: false, guilds: Array.isArray(j.guilds) ? j.guilds : [] } }))
    } catch {
      setGuildsState((s) => ({ ...s, [accountId]: { open: true, loading: false, guilds: [] } }))
    }
  }

  const memberAccounts = group.members
    .map((m) => ({ ...m, account: accounts.find((a) => a.id === m.accountId) }))
    .filter((m) => m.account)
  const groupedIds = new Set(allGroups.flatMap((g) => g.members.map((m) => m.accountId)))
  const availableAccounts = accounts.filter((a) => !groupedIds.has(a.id))

  const removeMember = async (accountId: string) => {
    await fetch(`/api/groups/${group.id}/members/${accountId}`, { method: "DELETE" })
    await onChange()
  }

  const onActivate = (accountId: string) => {
    const result = activateAccount(group.id, accountId)
    setActivateStatus((s) => ({ ...s, [accountId]: result.ok ? "✓ Activating…" : `× ${result.reason}` }))
    window.setTimeout(() => {
      setActivateStatus((s) => {
        const next = { ...s }
        delete next[accountId]
        return next
      })
    }, 4000)
  }

  return (
    <div className="rounded-card border border-bg-tertiary bg-bg-secondary p-4">
      <div className={cn("flex items-center justify-between gap-2", !collapsed && "mb-3")}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{group.name}</h2>
            <p className="text-[11px] text-muted-foreground">
              {group.members.length} account{group.members.length === 1 ? "" : "s"} ·{" "}
              {group.description || "no description"}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBulkJoinOpen(true)}
            disabled={memberAccounts.length === 0}
            title="Bulk-join every account in this group to a Discord server via an invite link"
          >
            <ServerCog className="h-3.5 w-3.5" /> Add to server
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add account
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} className="text-red hover:bg-red/10 hover:text-red">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {collapsed ? null : memberAccounts.length === 0 ? (
        <div className="rounded-md border border-dashed border-input p-4 text-center text-xs text-muted-foreground">
          No accounts in this group. Click "Add account" to pick from your captured accounts.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {memberAccounts.map((m) => {
            const gs = guildsState[m.accountId]
            return (
              <li key={m.accountId} className="rounded-md border border-bg-tertiary bg-bg-tertiary/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">@{m.account!.username}</div>
                    <div className="text-[10px] text-muted-foreground">{m.account!.label || ""}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {activateStatus[m.accountId] && (
                      <span className={cn("text-[10px]", activateStatus[m.accountId]?.startsWith("×") ? "text-red" : "text-emerald-500")}>
                        {activateStatus[m.accountId]}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleGuilds(m.accountId)}
                      title="View servers"
                      className={cn(
                        "rounded p-1 text-muted-foreground transition-colors hover:bg-bg-tertiary hover:text-text-normal",
                        gs?.open && "text-text-normal bg-bg-tertiary"
                      )}
                    >
                      <Globe className="h-3.5 w-3.5" />
                    </button>
                    <Button size="sm" onClick={() => onActivate(m.accountId)}>
                      Activate
                    </Button>
                    <button
                      type="button"
                      onClick={() => removeMember(m.accountId)}
                      aria-label="Remove from group"
                      className="text-muted-foreground hover:text-red"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {gs?.open && (
                  <div className="mt-1.5 max-h-28 overflow-y-auto rounded border border-bg-tertiary bg-bg-floating px-2 py-1">
                    {gs.loading ? (
                      <p className="text-[10px] text-muted-foreground">Loading…</p>
                    ) : gs.guilds && gs.guilds.length > 0 ? (
                      gs.guilds.map((g) => (
                        <div key={g.id} className="truncate py-0.5 text-[11px] text-text-normal">{g.name}</div>
                      ))
                    ) : (
                      <p className="text-[10px] text-muted-foreground">Not in any servers</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {pickerOpen && (
        <AddAccountPicker
          groupId={group.id}
          available={availableAccounts}
          onClose={() => setPickerOpen(false)}
          onAdded={onChange}
        />
      )}

      {bulkJoinOpen && (
        <BulkJoinInviteModal
          group={group}
          accounts={accounts}
          onClose={() => setBulkJoinOpen(false)}
        />
      )}
    </div>
  )
}
