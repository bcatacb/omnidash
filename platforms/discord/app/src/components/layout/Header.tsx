import { Bell, ChevronDown, Laptop, Moon, Search, Sun } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTheme } from "@/components/theme/ThemeProvider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ThemePreference } from "@/lib/theme"

const themeOptions: Array<{
  value: ThemePreference
  label: string
  icon: typeof Sun
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
]

export default function Header() {
  const navigate = useNavigate()
  const { preference, setPreference } = useTheme()
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [latestNotifications, setLatestNotifications] = useState<any[]>([])
  const [autoArchiveAfterReply, setAutoArchiveAfterReply] = useState<boolean>(() => {
    try {
      return localStorage.getItem("unibox.autoArchiveAfterReply") === "1"
    } catch {
      return false
    }
  })
  const notificationsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/dialogs")
        if (!res.ok) return
        const data = await res.json()
        const rows = (data || [])
          .filter((item: any) => item?.unread && !item?.isOut)
          .filter((item: any) => item?.dialogType ? item.dialogType === "user" : Boolean(item?.firstName || item?.lastName || item?.username))
          .sort((a: any, b: any) => new Date(String(b?.time || 0)).getTime() - new Date(String(a?.time || 0)).getTime())
          .slice(0, 8)
        setLatestNotifications(rows)
      } catch (e) {
        console.error("Failed to fetch notifications", e)
      }
    }

    fetchNotifications()
    const interval = setInterval(fetchNotifications, 15000)
    return () => clearInterval(interval)
  }, [])

  const unreadCount = useMemo(() => latestNotifications.length, [latestNotifications])
  const activeTheme = useMemo(
    () => themeOptions.find((option) => option.value === preference) ?? themeOptions[2],
    [preference],
  )

  useEffect(() => {
    if (!isNotificationsOpen) return
    const onClickOutside = (event: MouseEvent) => {
      if (!notificationsRef.current) return
      if (!notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [isNotificationsOpen])

  const openNotification = () => {
    setIsNotificationsOpen(false)
    navigate("/unibox")
  }

  const toggleAutoArchiveAfterReply = (enabled: boolean) => {
    setAutoArchiveAfterReply(enabled)
    try {
      localStorage.setItem("unibox.autoArchiveAfterReply", enabled ? "1" : "0")
    } catch {
      // ignore localStorage failures
    }
    window.dispatchEvent(new CustomEvent("tgsaas:auto-archive-after-reply", { detail: { enabled } }))
  }

  const handleThemeChange = (value: string) => {
    if (value === "light" || value === "dark" || value === "system") {
      setPreference(value)
    }
  }

  const ActiveThemeIcon = activeTheme.icon

  return (
    <header
      className="flex h-[56px] items-center justify-between border-b border-border/70 bg-card/75 px-3 text-card-foreground backdrop-blur-xl md:px-6"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex flex-1 items-center gap-4">
        {/* Logo on mobile (where sidebar is hidden) */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand md:hidden">
          <span className="text-sm font-bold text-white">⚡</span>
        </div>
        <form className="hidden w-full max-w-sm relative sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search campaigns, tags, or accounts..."
            className="h-10 max-w-[400px] rounded-xl border-border/80 bg-background/70 px-9 text-[13px] shadow-sm transition-all focus-visible:ring-[#0062FF]/20 focus-visible:ring-offset-0"
          />
        </form>
      </div>
      <div className="flex items-center gap-2 relative md:gap-4" ref={notificationsRef}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-full border-border/80 bg-background/75 px-2.5 text-foreground shadow-sm"
              aria-label={`Theme mode: ${activeTheme.label}`}
            >
              <ActiveThemeIcon className="h-3.5 w-3.5" />
              <span className="sr-only">Theme mode: {activeTheme.label}</span>
              <span className="hidden sm:inline">{activeTheme.label}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel>Theme mode</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={preference} onValueChange={handleThemeChange}>
              {themeOptions.map((option) => {
                const Icon = option.icon

                return (
                  <DropdownMenuRadioItem key={option.value} value={option.value} className="gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="hidden md:flex items-center gap-2 rounded-full border border-border/80 bg-background/75 px-3 py-1.5 shadow-sm">
          <span className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground">Auto-archive reply</span>
          <Switch checked={autoArchiveAfterReply} onCheckedChange={toggleAutoArchiveAfterReply} />
        </div>
        <button
          className="relative rounded-full border border-border/70 bg-background/75 p-2 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setIsNotificationsOpen((prev) => !prev)}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#0062FF] px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
        {isNotificationsOpen && (
          <div className="absolute right-0 top-11 z-50 w-[320px] max-w-[90vw] rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[13px] font-semibold text-popover-foreground">Latest notifications</p>
            </div>
            <div className="max-h-[360px] overflow-auto">
              {latestNotifications.length === 0 ? (
                <div className="px-3 py-4 text-[12px] text-muted-foreground">No unread direct-message notifications.</div>
              ) : (
                latestNotifications.map((item: any) => (
                  <button
                    key={`${item.accountId}_${item.peerId}_${item.time}`}
                    className="w-full border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent/80 last:border-b-0"
                    onClick={openNotification}
                  >
                    <p className="truncate text-[12px] font-semibold text-popover-foreground">{item.name || item.username || item.peerId}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.message || ""}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground/80">{new Date(item.time).toLocaleString()}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
