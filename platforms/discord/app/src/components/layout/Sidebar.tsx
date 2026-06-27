import { NavLink, useNavigate } from "react-router-dom"
import { useEffect, useState } from "react"
import {
  Activity,
  Globe,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  LogIn,
  LogOut,
  Megaphone,
  Radar,
  Shield,
  Users,
  Zap,
} from "lucide-react"

type NavItem = {
  name: string
  href: string
  icon: typeof LayoutDashboard
}

const navGroups: NavItem[][] = [
  [
    { name: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
  ],
  [
    { name: "Accounts", href: "/app/accounts", icon: Users },
    { name: "Account Health", href: "/app/health", icon: Activity },
    { name: "Browser sessions", href: "/app/sessions", icon: Globe },
    { name: "Proxies", href: "/app/proxies", icon: Shield },
  ],
  [
    { name: "Outreach", href: "/app/campaigns", icon: Megaphone },
    { name: "Member Scraper", href: "/app/scraper", icon: Radar },
    { name: "Server Joiner", href: "/app/joiner", icon: LogIn },
    { name: "Unibox", href: "/app/unibox", icon: Inbox },
  ],
]

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.href}
      className={({ isActive }) =>
        `relative group flex items-center justify-center h-10 w-10 rounded-xl transition-all duration-100 ease-out-discord ${
          isActive
            ? "bg-brand/10 text-brand ring-1 ring-brand/30 shadow-sm before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r before:bg-brand"
            : "text-text-muted hover:bg-bg-message-hover hover:text-text-normal"
        }`
      }
    >
      <item.icon className="h-5 w-5" />
      <div className="absolute left-full z-50 ml-2 whitespace-nowrap rounded border border-bg-tertiary bg-bg-floating px-2 py-1 text-[11px] font-medium text-text-normal opacity-0 shadow-lg transition-opacity pointer-events-none group-hover:opacity-100">
        {item.name}
      </div>
    </NavLink>
  )
}

export default function Sidebar() {
  const navigate = useNavigate()
  const [version, setVersion] = useState<{ version?: string; commit: string; date: string } | null>(null)

  useEffect(() => {
    fetch("/api/version")
      .then(r => r.json())
      .then(setVersion)
      .catch(() => setVersion({ commit: "?", date: "" }))
  }, [])

  const signOut = async () => {
    try {
      await fetch("/api/auth/signout", { method: "POST" })
    } catch (error) {
      console.error("Failed to sign out", error)
    } finally {
      localStorage.removeItem("tg_saas_session")
      localStorage.removeItem("tg_saas_user")
      navigate("/signin")
    }
  }

  return (
    <aside className="hidden md:flex w-[64px] flex-col items-center border-r border-bg-tertiary bg-bg-tertiary py-3 text-text-normal">
      {/* Logo */}
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-brand">
        <Zap className="h-4 w-4 text-white fill-current" />
      </div>

      {/* Nav groups */}
      <nav className="flex flex-1 flex-col items-center gap-3 w-full">
        {navGroups.map((group, gi) => (
          <div key={gi} className="flex flex-col items-center gap-1 w-full px-2">
            {group.map((item) => (
              <NavItemLink key={item.href} item={item} />
            ))}
            {gi < navGroups.length - 1 && (
              <div className="mt-2 h-px w-8 rounded-full bg-bg-tertiary opacity-60" />
            )}
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-2 mt-auto">
        <button
          className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-bg-message-hover hover:text-text-normal"
          title="Help"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-bg-message-hover hover:text-text-normal"
          onClick={signOut}
          title="Sign out"
        >
          <LogOut className="h-5 w-5" />
        </button>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-bg-tertiary bg-bg-secondary shadow-sm cursor-default select-none"
          title={version ? `v${version.version || "?"}  (${version.commit})${version.date ? `\n${version.date}` : ""}` : "Loading..."}
        >
          <span className="text-[9px] font-mono font-bold text-text-muted leading-none">
            {version ? `v${version.version || "?"}` : "···"}
          </span>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-bg-tertiary bg-bg-secondary shadow-sm">
          <span className="text-[11px] font-bold text-text-muted">JD</span>
        </div>
      </div>
    </aside>
  )
}
