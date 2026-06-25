import { NavLink, useNavigate } from "react-router-dom"
import { useState } from "react"
import { Inbox, Users, Megaphone, MoreHorizontal, Settings, LogOut, X, LayoutDashboard } from "lucide-react"

const tabs = [
  { name: "Unibox", href: "/app/unibox", icon: Inbox },
  { name: "Accounts", href: "/app/accounts", icon: Users },
  { name: "Warmups", href: "/app/campaigns", icon: Megaphone },
  { name: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
] as const

export default function MobileBottomNav() {
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

  const signOut = async () => {
    try {
      await fetch("/api/auth/signout", { method: "POST" })
    } catch (error) {
      console.error("Failed to sign out", error)
    } finally {
      localStorage.removeItem("tg_saas_session")
      localStorage.removeItem("tg_saas_user")
      setMoreOpen(false)
      navigate("/signin")
    }
  }

  return (
    <>
      <nav
        className="flex shrink-0 border-t border-bg-tertiary bg-bg-secondary/95 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary navigation"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.href}
            to={tab.href}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                isActive ? "text-brand" : "text-text-muted hover:text-text-normal"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <tab.icon className={`h-6 w-6 ${isActive ? "stroke-[2.25]" : ""}`} />
                <span>{tab.name}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-text-muted hover:text-text-normal"
        >
          <MoreHorizontal className="h-6 w-6" />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 md:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="rounded-t-2xl border-t border-bg-tertiary bg-bg-floating text-text-normal shadow-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-bg-tertiary px-5 py-3">
              <h2 className="text-base font-semibold">More</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-full text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setMoreOpen(false); navigate("/app/settings") }}
              className="flex w-full items-center gap-3 px-5 py-4 text-[14px] text-text-normal transition-colors hover:bg-bg-message-hover"
            >
              <Settings className="h-5 w-5 text-text-muted" /> Settings
            </button>
            <button
              type="button"
              onClick={signOut}
              className="flex w-full items-center gap-3 border-t border-bg-tertiary px-5 py-4 text-[14px] text-red transition-colors hover:bg-red/10"
            >
              <LogOut className="h-5 w-5" /> Sign out
            </button>
          </div>
        </div>
      )}
    </>
  )
}
