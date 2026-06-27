import { useState } from "react"
import { Link, Outlet } from "react-router-dom"
import { Menu, MessageCircle, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { publicFooterColumns, publicNavLinks } from "@/lib/public-site"

type PublicSiteShellProps = {
  showDemoButton?: boolean
  children?: React.ReactNode
}

export default function PublicSiteShell({ showDemoButton = true, children }: PublicSiteShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const closeMobileNav = () => setMobileOpen(false)

  const content = children ?? <Outlet />

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <header className="sticky top-0 z-40 border-b border-[hsl(var(--border))]/70 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900" onClick={closeMobileNav}>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-white shadow-sm">
              <Send className="h-4 w-4" />
            </span>
            <span>Droply</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-slate-600 md:flex">
            {publicNavLinks.map((item) => (
              <Link key={item.label} to={item.href} className="transition hover:text-slate-900">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" asChild>
              <Link to="/signin">Login</Link>
            </Button>
            {showDemoButton && (
              <Button variant="outline" asChild>
                <Link to="/signin">See Demo</Link>
              </Button>
            )}
            <Button asChild>
              <Link to="/signup">Get Started</Link>
            </Button>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-white text-slate-700 shadow-sm transition hover:text-slate-900 md:hidden"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileOpen && (
          <div className="border-t border-[hsl(var(--border))] bg-white px-6 py-4 md:hidden">
            <nav className="flex flex-col gap-2 text-sm text-slate-700">
              {publicNavLinks.map((item) => (
                <Link
                  key={item.label}
                  to={item.href}
                  className="rounded-xl px-3 py-2 transition hover:bg-slate-50 hover:text-slate-900"
                  onClick={closeMobileNav}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="ghost" asChild className="justify-center">
                <Link to="/signin" onClick={closeMobileNav}>Login</Link>
              </Button>
              {showDemoButton && (
                <Button variant="outline" asChild className="justify-center">
                  <Link to="/signin" onClick={closeMobileNav}>See Demo</Link>
                </Button>
              )}
              <Button asChild className="justify-center">
                <Link to="/signup" onClick={closeMobileNav}>Get Started</Link>
              </Button>
            </div>
          </div>
        )}
      </header>

      <main>{content}</main>

      <footer className="border-t border-[hsl(var(--border))] bg-white/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          <div className="grid gap-10 md:grid-cols-[1.1fr_repeat(3,1fr)]">
            <div>
              <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-white shadow-sm">
                  <Send className="h-4 w-4" />
                </span>
                <span>Droply</span>
              </Link>
              <p className="mt-4 max-w-xs text-sm leading-6 text-slate-600">
                Telegram outreach infrastructure for teams that want more replies, cleaner operations, and better pipeline visibility.
              </p>
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-slate-500">
                <MessageCircle className="h-4 w-4" /> Built for outbound teams
              </p>
            </div>

            {publicFooterColumns.map((column) => (
              <div key={column.title}>
                <p className="text-sm font-semibold text-slate-900">{column.title}</p>
                <ul className="mt-4 space-y-3 text-sm text-slate-600">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a href={link.href} className="transition hover:text-slate-900">
                          {link.label}
                        </a>
                      ) : (
                        <Link to={link.href} className="transition hover:text-slate-900">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-10 border-t border-[hsl(var(--border))] pt-6 text-sm text-slate-500">
            © {new Date().getFullYear()} Droply. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
