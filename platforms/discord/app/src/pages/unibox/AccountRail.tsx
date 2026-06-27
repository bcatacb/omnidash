import { useState } from "react"
import { cn } from "@/lib/utils"
import type { AccountStatus } from "@/api-types"
import { avatarColorFromId, getInitials } from "./utils"
import type { AccountSummary } from "./store"

interface AccountRailProps {
  accounts: AccountSummary[]
  selectedAccountId: string | "all"
  onSelectAccount: (id: string | "all") => void
}

const STATUS_DOT_COLOR: Record<AccountStatus, string> = {
  connected: "bg-green",
  connecting: "bg-yellow",
  captcha: "bg-yellow",
  disconnected: "bg-text-muted",
  banned: "bg-red",
  token_revoked: "bg-amber-500",
}

const STATUS_LABEL: Record<AccountStatus, string> = {
  connected: "Online",
  connecting: "Connecting",
  captcha: "Captcha required",
  disconnected: "Offline",
  banned: "Banned",
  token_revoked: "Token revoked — re-onboard",
}

function AccountAvatar({
  account,
  active,
}: {
  account: AccountSummary
  active: boolean
}) {
  const bg = avatarColorFromId(account.id)
  return (
    <div className="relative">
      <div
        className={cn(
          "h-12 w-12 overflow-hidden flex items-center justify-center select-none",
          "text-white text-sm font-semibold",
          "transition-[border-radius,box-shadow] duration-150 ease-out-discord",
          active ? "rounded-card" : "rounded-full group-hover:rounded-card",
        )}
        style={{ backgroundColor: account.avatarUrl ? undefined : bg }}
      >
        {account.avatarUrl ? (
          <img
            src={account.avatarUrl}
            alt={account.label}
            className="h-full w-full object-cover"
          />
        ) : (
          getInitials(account.label || account.username)
        )}
      </div>
      <span
        title={STATUS_LABEL[account.status]}
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-bg-tertiary",
          STATUS_DOT_COLOR[account.status],
        )}
      />
    </div>
  )
}

export default function AccountRail({
  accounts,
  selectedAccountId,
  onSelectAccount,
}: AccountRailProps) {
  const [tooltip, setTooltip] = useState<{ account: AccountSummary; y: number } | null>(null)

  return (
    <nav
      aria-label="Bridged accounts"
      className="flex h-full flex-col items-center bg-bg-tertiary w-[72px]"
    >
      {/* "All" pill — always visible at the top */}
      <div className="flex shrink-0 flex-col items-center gap-2 pt-3 pb-2">
        <button
          type="button"
          onClick={() => onSelectAccount("all")}
          className="group relative flex items-center justify-center"
          aria-label="All accounts"
          aria-pressed={selectedAccountId === "all"}
        >
          <span
            aria-hidden
            className={cn(
              "absolute -left-3 w-1 rounded-r-full bg-text-normal transition-all duration-150",
              selectedAccountId === "all" ? "h-10" : "h-0 group-hover:h-5",
            )}
          />
          <div
            className={cn(
              "h-12 w-12 flex items-center justify-center text-sm font-semibold",
              "transition-[border-radius,background-color] duration-150 ease-out-discord",
              selectedAccountId === "all"
                ? "rounded-card bg-brand text-white"
                : "rounded-full bg-bg-secondary text-text-normal group-hover:rounded-card group-hover:bg-brand group-hover:text-white",
            )}
          >
            All
          </div>
        </button>

        <div className="my-1 h-px w-8 bg-bg-secondary" aria-hidden />
      </div>

      {/* Scrollable accounts list */}
      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {accounts.map((acct) => {
          const active = selectedAccountId === acct.id
          return (
            <button
              key={acct.id}
              type="button"
              onClick={() => onSelectAccount(acct.id)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setTooltip({ account: acct, y: rect.top + rect.height / 2 })
              }}
              onMouseLeave={() => setTooltip(null)}
              className="group relative flex shrink-0 items-center justify-center"
              aria-label={`Filter to ${acct.label}`}
              aria-pressed={active}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute -left-3 w-1 rounded-r-full bg-text-normal transition-all duration-150",
                  active ? "h-10" : "h-0 group-hover:h-5",
                )}
              />
              <AccountAvatar account={acct} active={active} />
            </button>
          )
        })}

        {accounts.length === 0 && (
          <p className="px-1 text-center text-[10px] text-text-muted leading-tight mt-2">
            No bridged accounts yet
          </p>
        )}
      </div>

      {/* Fixed tooltip — rendered outside overflow container so it's never clipped */}
      {tooltip && (
        <div
          className="pointer-events-none fixed left-[72px] z-[100] ml-3 flex flex-col items-start whitespace-nowrap rounded-md bg-bg-floating px-2.5 py-1.5 text-[12px] text-text-normal shadow-lg ring-1 ring-black/30"
          style={{ top: tooltip.y, transform: "translateY(-50%)" }}
        >
          <span className="font-semibold">{tooltip.account.label || tooltip.account.username}</span>
          <span className="text-[10px] text-text-muted">@{tooltip.account.username}</span>
        </div>
      )}
    </nav>
  )
}
