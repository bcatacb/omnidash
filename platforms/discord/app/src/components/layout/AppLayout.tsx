import { Outlet } from "react-router-dom"
import Sidebar from "./Sidebar"
import Header from "./Header"
import MobileBottomNav from "./MobileBottomNav"

export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background/60 text-foreground">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto text-foreground">
          <Outlet />
        </main>
        {/* Mobile bottom nav: flex sibling (not fixed) so it claims its own
            row and main shrinks accordingly — composer never hides behind it.
            `md:hidden` keeps it absent on desktop, leaving the layout
            byte-identical to before. */}
        <MobileBottomNav />
      </div>
    </div>
  )
}
