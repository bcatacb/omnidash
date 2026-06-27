import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

function getTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function Layout({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">(getTheme);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
    setTheme(next);
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link ${isActive ? "nav-link-active" : ""}`;

  return (
    <div className="min-h-screen flex bg-bg text-fg">
      <nav className="w-48 bg-surface border-r border-border p-3 space-y-1 flex flex-col">
        <div className="app-title text-lg mb-3">DuoPlus</div>
        <NavLink to="/" className={navClass}>Fleet</NavLink>
        <NavLink to="/proxies" className={navClass}>Proxies</NavLink>
        <NavLink to="/groups" className={navClass}>Groups</NavLink>
        <NavLink to="/apps" className={navClass}>Apps</NavLink>
        <NavLink to="/drive" className={navClass}>Drive</NavLink>
        <NavLink to="/automation" className={navClass}>Automation</NavLink>
        <NavLink to="/numbers" className={navClass}>Numbers</NavLink>
        <NavLink to="/orders" className={navClass}>Orders</NavLink>
        <NavLink to="/subscriptions" className={navClass}>Subscriptions</NavLink>
        <NavLink to="/provision" className={navClass}>Provision</NavLink>
        <NavLink to="/reports" className={navClass}>Reports</NavLink>
        <button className="btn btn-ghost mt-auto" onClick={toggleTheme} aria-label="toggle theme">
          {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
        </button>
      </nav>
      <main className="flex-1 bg-bg">{children}</main>
    </div>
  );
}
