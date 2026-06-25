import { lazy, Suspense } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import AppLayout from "./components/layout/AppLayout"
import Dashboard from "./pages/Dashboard"
import Settings from "./pages/Settings"
import Landing from "./pages/Landing"
import PricingPage from "./pages/PricingPage"
import SignIn from "./pages/SignIn"
import SignUp from "./pages/SignUp"
import RequireAuth from "./components/auth/RequireAuth"
import { ConfirmProvider } from "./components/ui/confirm"

// Lazy-loaded Discord unibox pages (authored by Agents F/G/H).
const Accounts = lazy(() => import("./pages/Accounts"))
const Campaigns = lazy(() => import("./pages/Campaigns"))
const CampaignDetail = lazy(() => import("./pages/campaigns/CampaignDetail"))
const WarmupMonitor = lazy(() => import("./pages/campaigns/WarmupMonitor"))
const FrCampaignDetail = lazy(() => import("./pages/campaigns/FrCampaignDetail"))
const Unibox = lazy(() => import("./pages/Unibox"))
const BrowserSessions = lazy(() => import("./pages/BrowserSessions"))
const Proxies = lazy(() => import("./pages/Proxies"))
const MemberScraper = lazy(() => import("./pages/MemberScraper"))
const AccountHealth = lazy(() => import("./pages/AccountHealth"))
const ServerJoiner = lazy(() => import("./pages/ServerJoiner"))

function LazyFallback() {
  return <div className="p-8 text-text-muted">Loading…</div>
}

function App() {
  return (
    <BrowserRouter>
      <ConfirmProvider>
      <Suspense fallback={<LazyFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="/landing" element={<Landing />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<SignIn />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="/settings" element={<Navigate to="/app/settings" replace />} />
          <Route path="/accounts" element={<Navigate to="/app/accounts" replace />} />
          <Route path="/campaigns" element={<Navigate to="/app/campaigns" replace />} />
          <Route path="/unibox" element={<Navigate to="/app/unibox" replace />} />
          <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="settings" element={<Settings />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/fr/:id" element={<FrCampaignDetail />} />
            <Route path="campaigns/warmup/:id" element={<WarmupMonitor />} />
            <Route path="campaigns/:id" element={<CampaignDetail />} />
            <Route path="unibox" element={<Unibox />} />
            <Route path="unibox/c/:conversationId" element={<Unibox />} />
            <Route path="sessions" element={<BrowserSessions />} />
            <Route path="proxies" element={<Proxies />} />
            <Route path="scraper" element={<MemberScraper />} />
            <Route path="health" element={<AccountHealth />} />
            <Route path="joiner" element={<ServerJoiner />} />
          </Route>
        </Routes>
      </Suspense>
      </ConfirmProvider>
    </BrowserRouter>
  )
}

export default App
