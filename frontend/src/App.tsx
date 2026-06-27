import { useState, useEffect, useRef, useMemo } from 'react'
import { 
  Home, Inbox, Send, Hash, Video, ExternalLink, Search, 
  Bell, ArrowRight, User, Camera 
} from 'lucide-react'
import './App.css'
import { getAllTransformers, getTransformer } from './adapters'
import type { OmniConversation, OmniMessage, OmniAccount } from './types/omni'
import { PLATFORM_COLOR, PLATFORM_LABEL } from './types/omni'

type PlatformId = 'telegram' | 'discord' | 'tiktok' | 'instagram' | 'snapchat' | 'facebook'

interface Platform {
  id: PlatformId
  name: string
  tagline: string
  color: string
  icon: React.ReactNode
  implemented: boolean
}

const PLATFORMS: Platform[] = [
  { 
    id: 'telegram', 
    name: 'Telegram', 
    tagline: 'Messages, groups, channels & campaigns', 
    color: '#229ED9',
    icon: <Send className="w-5 h-5" />,
    implemented: true,
  },
  { 
    id: 'discord', 
    name: 'Discord', 
    tagline: 'Unibox, outreach, warmup & leads', 
    color: '#5865F2',
    icon: <Hash className="w-5 h-5" />,
    implemented: true,
  },
  { 
    id: 'tiktok', 
    name: 'TikTok', 
    tagline: 'DM inbox, pipeline & automation', 
    color: '#FE2C55',
    icon: <Video className="w-5 h-5" />,
    implemented: true,
  },
  { 
    id: 'instagram', 
    name: 'Instagram', 
    tagline: 'DMs and stories (coming soon)', 
    color: '#E1306C',
    icon: <Camera className="w-5 h-5" />,
    implemented: false,
  },
  { 
    id: 'snapchat', 
    name: 'Snapchat', 
    tagline: 'Snaps and chats (coming soon)', 
    color: '#FFFC00',
    icon: <User className="w-5 h-5" />,
    implemented: false,
  },
  { 
    id: 'facebook', 
    name: 'Facebook', 
    tagline: 'Messenger, Pages & ads (coming soon)', 
    color: '#1877F2',
    icon: <div className="w-5 h-5 flex items-center justify-center text-[15px] font-black tracking-[-1px]">f</div>,
    implemented: false,
  },
]

function App() {
  const [activeView, setActiveView] = useState<'home' | 'unified' | PlatformId>('home')
  const [pendingUnifiedPlatform, setPendingUnifiedPlatform] = useState<PlatformId | null>(null)
  const [headerSearchTerm, setHeaderSearchTerm] = useState('')
  const [sidebarUnread, setSidebarUnread] = useState(0)
  const [platformUnreads, setPlatformUnreads] = useState<Record<string, number>>({})

  // Unified compose state (progress toward unified send experience)
  const [showCompose, setShowCompose] = useState(false)
  const [composePlatform, setComposePlatform] = useState<PlatformId>('telegram')
  const [composeAccountId, setComposeAccountId] = useState('')
  const [composeAccounts, setComposeAccounts] = useState<OmniAccount[]>([])
  const [composePeerName, setComposePeerName] = useState('')
  const [composeBody, setComposeBody] = useState('')

  // For forcing inbox to reload after unified actions like compose send
  const [inboxRefreshKey, setInboxRefreshKey] = useState(0)
  const [pendingSelectedId, setPendingSelectedId] = useState<string | null>(null)

  const currentPlatform = PLATFORMS.find(p => p.id === activeView) as Platform | undefined

  const goHome = () => setActiveView('home')
  const goUnified = () => { setPendingUnifiedPlatform(null); setHeaderSearchTerm(''); setActiveView('unified') }
  const openPlatform = (id: PlatformId) => setActiveView(id)

  // Load sidebar unread count + per-platform (lightweight, runs on mount)
  useEffect(() => {
    async function loadSidebarUnread() {
      const ts = getAllTransformers()
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

      const results = await Promise.allSettled(ts.map(async (t) => {
        const cs = await withTimeout(t.listConversations({ archived: false }), 5000)
        const u = cs.reduce((n, c) => n + (c.unreadCount || 0), 0)
        return { platform: t.platform, unread: u }
      }))

      let total = 0
      const per: Record<string, number> = {}
      for (const r of results) {
        if (r.status === 'fulfilled') {
          per[r.value.platform] = r.value.unread
          total += r.value.unread
        }
      }
      setSidebarUnread(total)
      setPlatformUnreads(per)
    }
    loadSidebarUnread()
  }, [])

  // Load accounts for compose when platform or modal changes
  useEffect(() => {
    if (!showCompose) return
    const t = getTransformer(composePlatform)
    if (t) {
      t.listAccounts().then(acs => {
        setComposeAccounts(acs as OmniAccount[])
        if (acs.length > 0 && !composeAccountId) {
          setComposeAccountId(acs[0].id)
        }
      })
    }
  }, [showCompose, composePlatform])

  function goToUnifiedFiltered(id: PlatformId) {
    setPendingUnifiedPlatform(id)
    setActiveView('unified')
  }

  // setPendingPlatformFilter kept for potential direct use; currently driven via goToUnifiedFiltered


  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-normal)] font-sans">
      {/* Sidebar */}
      <div className="w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col">
        {/* Logo */}
        <div className="h-16 px-5 flex items-center border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[10px] bg-[var(--brand)] flex items-center justify-center text-white font-semibold text-[15px] tracking-[-0.5px]">
              OD
            </div>
            <div className="leading-none">
              <div className="font-semibold text-[17px] tracking-[-0.3px]">OmniDash</div>
              <div className="text-[10px] text-[var(--text-muted)] -mt-px">unified messaging</div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-2 py-3 overflow-y-auto text-[13px]">
          {/* Main nav */}
          <div className="px-3 mb-1 text-[10px] font-medium tracking-[1px] text-[var(--text-muted)]">OVERVIEW</div>
          <div className="space-y-0.5 mb-5">
            <NavItem 
              icon={<Home className="w-4 h-4" />} 
              label="Home" 
              active={activeView === 'home'} 
              onClick={goHome} 
            />
            <NavItem 
              icon={<Inbox className="w-4 h-4" />} 
              label="Unified Inbox" 
              active={activeView === 'unified'} 
              onClick={goUnified}
              badge={sidebarUnread > 0 ? sidebarUnread.toString() : undefined}
            />
          </div>

          {/* Platforms */}
          <div className="px-3 mb-1.5 text-[10px] font-medium tracking-[1px] text-[var(--text-muted)]">PLATFORMS</div>
          <div className="space-y-0.5">
            {PLATFORMS.map((platform) => {
              const t = getTransformer(platform.id)
              const ch = t?.getCharacteristics?.()
              const extra = ch ? ` (${ch.transport})` : ''
              return (
                <NavItem 
                  key={platform.id}
                  icon={<div style={{ color: platform.color }}>{platform.icon}</div>}
                  label={platform.name + extra}
                  active={activeView === platform.id}
                  onClick={() => openPlatform(platform.id)}
                  badge={platformUnreads[platform.id] > 0 ? platformUnreads[platform.id].toString() : undefined}
                />
              )
            })}
          </div>
        </div>

        <div className="p-3 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] px-4">
          unified via transformers • {PLATFORMS.map(p => {
            const t = getTransformer(p.id)
            const ch = t?.getCharacteristics?.()
            return ch ? `${p.id[0]}:${ch.transport}` : p.id
          }).join(' ')}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-14 bg-[var(--bg-secondary)]/95 backdrop-blur border-b border-[var(--border)] px-6 flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="font-semibold text-[15px] tracking-tight">
              {activeView === 'home' && 'Dashboard'}
              {activeView === 'unified' && 'Unified Inbox'}
              {currentPlatform && currentPlatform.name}
            </div>
            {currentPlatform && (() => {
              const t = getTransformer(currentPlatform.id)
              const ch = t?.getCharacteristics?.()
              return (
                <div className="flex items-center gap-1">
                  <div 
                    className="px-2 py-px text-[10px] rounded font-medium" 
                    style={{ backgroundColor: `${currentPlatform.color}22`, color: currentPlatform.color }}
                  >
                    CONNECTED
                  </div>
                  {ch && (
                    <div className="px-1.5 py-px text-[9px] rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                      {ch.transport} • ~{ch.typicalSendLatencyMs}ms
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative w-80">
              <Search className="absolute left-3 top-[7px] w-4 h-4 text-[var(--text-muted)]" />
              <input 
                type="text" 
                placeholder="Search all conversations..." 
                value={headerSearchTerm}
                onChange={e => setHeaderSearchTerm(e.target.value)}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg pl-9 pr-8 py-1 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && headerSearchTerm.trim()) {
                    goUnified()
                  }
                }}
              />
              {headerSearchTerm && (
                <button
                  onClick={() => setHeaderSearchTerm('')}
                  className="absolute right-2 top-[5px] text-[var(--text-muted)] hover:text-[var(--text-normal)] text-lg leading-none"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <button
              onClick={() => {
                setShowCompose(true)
                setComposePeerName('')
                setComposeBody('')
              }}
              className="px-3 py-1 text-sm font-medium rounded-lg bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)] transition"
            >
              Compose
            </button>

            <button className="p-2 hover:bg-[var(--bg-message-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-normal)] transition-colors">
              <Bell className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 pl-3 border-l border-[var(--border)]">
              <div className="w-6 h-6 bg-[var(--brand)] rounded-full flex items-center justify-center text-[10px] font-bold">JD</div>
              <span className="text-xs text-[var(--text-muted)]">you@omnidash</span>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto bg-[var(--bg-primary)]">
          {activeView === 'home' && <HomeDashboard onOpenPlatform={openPlatform} onOpenUnified={goUnified} />}
          {activeView === 'unified' && <UnifiedInbox pendingPlatformFilter={pendingUnifiedPlatform} onFilterConsumed={() => setPendingUnifiedPlatform(null)} initialQuery={headerSearchTerm} refreshKey={inboxRefreshKey} onOpenCompose={() => setShowCompose(true)} pendingSelectedId={pendingSelectedId} onSelectedConsumed={() => setPendingSelectedId(null)} />}
          {currentPlatform && <EmbeddedApp platform={currentPlatform} />}
        </div>

        {/* Unified Compose Modal - step toward full cross-platform sending */}
        {showCompose && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCompose(false)}>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="font-semibold text-lg">New Message (Unified)</div>
                <button onClick={() => setShowCompose(false)} className="text-[var(--text-muted)] hover:text-[var(--text-normal)]">×</button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[var(--text-muted)]">Platform</label>
                  <select
                    value={composePlatform}
                    onChange={e => { setComposePlatform(e.target.value as PlatformId); setComposeAccountId('') }}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  >
                    {PLATFORMS.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-muted)]">Account</label>
                  <select
                    value={composeAccountId}
                    onChange={e => setComposeAccountId(e.target.value)}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  >
                    {composeAccounts.length === 0 && <option value="">Loading...</option>}
                    {composeAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.label} ({a.username})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-muted)]">To</label>
                  <input
                    value={composePeerName}
                    onChange={e => setComposePeerName(e.target.value)}
                    placeholder="Name or @handle"
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--text-muted)]">Message</label>
                  <textarea
                    value={composeBody}
                    onChange={e => setComposeBody(e.target.value)}
                    placeholder="Write your message..."
                    rows={4}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button onClick={() => setShowCompose(false)} className="flex-1 py-2 rounded border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">Cancel</button>
                <button
                  onClick={async () => {
                    if (!composeAccountId || !composePeerName.trim() || !composeBody.trim()) return
                    const t = getTransformer(composePlatform)
                    if (!t) return
                    try {
                      const conv = await t.startConversation(composeAccountId, { displayName: composePeerName.trim() })
                      await t.sendMessage(conv.id, composeBody.trim())
                      setShowCompose(false)
                      setComposePeerName('')
                      setComposeBody('')

                      // Unification step: if inbox is visible, trigger it to reload so the new convo appears
                      if (activeView === 'unified') {
                        setInboxRefreshKey(k => k + 1)
                        setPendingSelectedId(conv.id)
                      } else {
                        // Jump to unified and pre-select the new convo
                        goUnified()
                        setPendingSelectedId(conv.id)
                        // refreshKey will be handled on mount
                      }
                    } catch (e) {
                      console.error('Unified send failed', e)
                      alert('Send failed — is the platform backend running?')
                    }
                  }}
                  disabled={!composeAccountId || !composePeerName.trim() || !composeBody.trim()}
                  className="flex-1 py-2 rounded bg-[var(--brand)] text-white disabled:opacity-50"
                >
                  Send
                </button>
              </div>

              <div className="text-[10px] text-[var(--text-muted)] mt-3 text-center">
                Sending via {PLATFORM_LABEL[composePlatform]} • unified composer
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function NavItem({ 
  icon, 
  label, 
  active, 
  onClick, 
  badge 
}: { 
  icon: React.ReactNode; 
  label: string; 
  active?: boolean; 
  onClick: () => void; 
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-[7px] rounded-lg text-[13px] transition-all ${
        active 
          ? 'bg-[var(--bg-message-hover)] text-[var(--text-normal)] font-medium' 
          : 'text-[var(--text-normal)] hover:bg-[var(--bg-message-hover)]/60'
      }`}
    >
      <div className="flex items-center gap-2.5">
        {icon}
        <span>{label}</span>
      </div>
      {badge && (
        <span className="text-[9px] px-1.5 py-px rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">{badge}</span>
      )}
    </button>
  )
}

// ====================== HOME DASHBOARD (now live from transformers / intra-API) ======================
type PlatformSummary = {
  accounts: number
  conversations: number
  unread: number
  lastPreview: string
}

// Each platform's standalone dashboard ("full app"), env-configured per platform
// (VITE_<PLATFORM>_APP_URL). Served over Cloudflare Tunnel on *.deadbread.space.
function platformAppUrl(platformId: string): string | undefined {
  const env = (import.meta as any).env || {}
  const urls: Record<string, string | undefined> = {
    telegram: env.VITE_TELEGRAM_APP_URL,
    discord: env.VITE_DISCORD_APP_URL,
    tiktok: env.VITE_TIKTOK_APP_URL,
  }
  return urls[platformId]
}

function openFullApp(platformId: string) {
  const url = platformAppUrl(platformId)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
  else alert(`The full app for ${platformId} isn't configured yet.`)
}

// Embeds a platform's full app inside the OmniDash shell (iframe).
function EmbeddedApp({ platform }: { platform: { id: string; name: string } }) {
  const url = platformAppUrl(platform.id)
  if (!url) return (
    <div className="p-8 text-[var(--text-muted)] text-sm">
      No standalone app is configured for {platform.name} yet.
    </div>
  )
  return (
    <div className="h-full w-full flex flex-col">
      <div className="h-9 px-4 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] text-xs flex-shrink-0">
        <span className="text-[var(--text-muted)]">{platform.name} · full app</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--brand)] hover:underline">Open in new tab ↗</a>
      </div>
      <iframe src={url} title={`${platform.name} full app`} className="flex-1 w-full border-0" />
    </div>
  )
}

function HomeDashboard({ onOpenPlatform, onOpenUnified }: { 
  onOpenPlatform: (id: PlatformId) => void; 
  onOpenUnified: () => void;
}) {
  const [totalUnread, setTotalUnread] = useState(0)
  const [activeThreads, setActiveThreads] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [platformSummaries, setPlatformSummaries] = useState<Record<PlatformId, PlatformSummary>>({
    telegram: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
    discord: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
    tiktok: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
    instagram: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
    snapchat: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
    facebook: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
  })
  const [totalAccounts, setTotalAccounts] = useState(0)
  const [totalConvs, setTotalConvs] = useState(0)
  const [usingDemo, setUsingDemo] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadLive() {
      const adpts = getAllTransformers()

      // Fetch each platform in parallel with a 5s timeout per platform.
      // This prevents one unreachable backend from blocking the entire dashboard.
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

      const results = await Promise.allSettled(adpts.map(async (ad) => {
        const plat = ad.platform as PlatformId
        // Fetch accounts and conversations INDEPENDENTLY — a slow/failing
        // conversations call (e.g. Telegram's cache warming) must not throw away
        // the account count too. Conversations gets a longer timeout for the same
        // reason.
        let accs: OmniAccount[] = []
        let convs: OmniConversation[] = []
        let error: string | null = null
        try {
          accs = await withTimeout(ad.listAccounts(), 8000)
        } catch (e) {
          error = e instanceof Error ? e.message : String(e)
          console.warn(`[OmniDash] ${plat} listAccounts failed: ${error}`)
        }
        try {
          convs = await withTimeout(ad.listConversations({ archived: false }), 15000)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn(`[OmniDash] ${plat} listConversations failed: ${msg}`)
          if (!error) error = msg
        }
        const unread = convs.reduce((n, c) => n + c.unreadCount, 0)
        const recent = [...convs].sort((a, b) =>
          (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')
        )[0]
        return {
          plat,
          accs,
          convs,
          summary: {
            accounts: accs.length,
            conversations: convs.length,
            unread,
            lastPreview: recent?.lastMessagePreview
              || (accs.length ? 'No messages yet' : (error ? '⚠ Backend unreachable' : '—')),
          } as PlatformSummary,
          error,
        }
      }))

      if (cancelled) return

      const allConvs: OmniConversation[] = []
      const allAccs: OmniAccount[] = []
      const sums: Record<PlatformId, PlatformSummary> = {
        telegram: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
        discord: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
        tiktok: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
        instagram: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
        snapchat: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
        facebook: { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' },
      }

      for (const r of results) {
        const val = r.status === 'fulfilled' ? r.value : null
        if (!val) continue
        sums[val.plat] = val.summary
        allAccs.push(...val.accs)
        allConvs.push(...val.convs)
      }

      const unread = allConvs.reduce((n, c) => n + c.unreadCount, 0)
      const active = allConvs.length
      const todayStr = new Date().toDateString()
      const today = allConvs.reduce((n, c) =>
        n + (c.lastMessageAt && new Date(c.lastMessageAt).toDateString() === todayStr ? 1 : 0), 0)

      setTotalUnread(unread)
      setActiveThreads(active)
      setTodayCount(today)
      setPlatformSummaries(sums)
      setTotalAccounts(allAccs.length)
      setTotalConvs(allConvs.length)
      const hasDemo = allAccs.some(a => (a.id || '').includes('demo') || (a.label || '').includes('demo'))
      setUsingDemo(hasDemo)
    }

    loadLive()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Hero + stats */}
      <div className="mb-8">
        {usingDemo && (
          <div className="mb-2 px-3 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded">
            Using demo data — run platform backends (Telegram/Discord/TikTok) and set VITE_*_API envs for live data
          </div>
        )}
        <div className="flex items-center gap-2 text-[var(--green)] text-xs font-semibold tracking-[1.5px] mb-1">
          <div className="w-1.5 h-1.5 bg-[var(--green)] rounded-full" /> ALL SYSTEMS OPERATIONAL
        </div>
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-[44px] font-semibold tracking-[-2.6px] leading-none">OmniDash</h1>
            <p className="text-[var(--text-muted)] mt-1 text-[15px]">One place for every conversation across your apps. (unified intra-API over heterogeneous platforms)</p>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm">
            <div>
              <div className="text-[var(--text-muted)] text-xs tracking-widest">TODAY</div>
              <div className="text-2xl font-semibold tabular-nums">{todayCount} <span className="text-base font-normal text-[var(--text-muted)]">active</span></div>
            </div>
            <div>
              <div className="text-[var(--text-muted)] text-xs tracking-widest">UNREAD</div>
              <div className="text-2xl font-semibold tabular-nums text-[var(--yellow)]">{totalUnread}</div>
            </div>
            <div>
              <div className="text-[var(--text-muted)] text-xs tracking-widest">ACTIVE</div>
              <div className="text-2xl font-semibold tabular-nums">{activeThreads} <span className="text-base font-normal text-[var(--text-muted)]">threads</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Platforms Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="text-[11px] font-semibold tracking-[1.5px] text-[var(--text-muted)]">YOUR PLATFORMS</div>
          <div className="text-[10px] text-[var(--text-muted)]">{totalAccounts} accounts • {totalConvs} conversations</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {PLATFORMS.map((p) => {
            const s = platformSummaries[p.id] || { accounts: 0, conversations: 0, unread: 0, lastPreview: '—' }
            return (
              <div 
                key={p.id}
                onClick={() => onOpenPlatform(p.id)}
                className="omni-card group cursor-pointer border border-[var(--border)] bg-[var(--bg-secondary)] rounded-[10px] overflow-hidden hover:border-[var(--brand)] flex flex-col shadow-[0_1px_2px_rgb(0,0,0,0.3)] hover:shadow-[0_10px_15px_-3px_rgb(0,0,0,0.3)] transition-all hover:-translate-y-px relative"
              >
                {/* Left accent bar */}
                <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ backgroundColor: p.color }} />

                <div className="p-5 pl-7 flex flex-col flex-1">
                  {/* Header */}
                  <div className="flex items-start gap-3 mb-3">
                    <div 
                      className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl shadow-sm flex-shrink-0 ring-1 ring-inset ring-white/10"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-[20px] tracking-[-0.4px] leading-none">{p.name}</div>
                        <div className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${p.implemented ? 'bg-[rgba(35,165,90,0.12)] text-[var(--green)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}>
                          <div className={`status-dot ${p.implemented ? 'bg-[var(--green)]' : 'bg-[var(--text-muted)]'}`} />
                          {p.implemented ? 'ONLINE' : 'COMING SOON'}
                        </div>
                        {(() => {
                          const t = getTransformer(p.id)
                          const ch = t?.getCharacteristics?.()
                          return ch ? <span className="text-[9px] text-[var(--text-muted)]">{ch.transport}</span> : null
                        })()}
                      </div>
                      <div className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-snug pr-1">{p.tagline}</div>
                    </div>
                  </div>

                  {/* Stats + account indicators */}
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1.5">
                    <div>
                      <span><span className="font-medium text-[var(--text-normal)]">{s.accounts}</span> accounts</span>
                      <span className="text-[var(--border)]"> · </span>
                      <span><span className="font-medium text-[var(--text-normal)]">{s.conversations}</span> conversations</span>
                      {(() => {
                        const t = getTransformer(p.id)
                        const ch = t?.getCharacteristics?.()
                        return ch ? <div className="text-[9px] text-[var(--text-muted)] mt-0.5">{ch.transport} ~{ch.typicalSendLatencyMs}ms</div> : null
                      })()}
                      {p.implemented && s.accounts === 0 && (
                        <div className="text-[9px] text-yellow-400 mt-0.5">
                          {s.lastPreview.startsWith('⚠') ? s.lastPreview : 'Connect backend for live data'}
                        </div>
                      )}
                    </div>
                    <div className="flex -space-x-[1px]">
                      <div className="w-[13px] h-[13px] rounded-full ring-[1.5px] ring-[var(--bg-secondary)]" style={{ background: p.color }}></div>
                      <div className="w-[13px] h-[13px] rounded-full ring-[1.5px] ring-[var(--bg-secondary)]" style={{ background: '#3b82f6' }}></div>
                      <div className="w-[13px] h-[13px] rounded-full ring-[1.5px] ring-[var(--bg-secondary)]" style={{ background: '#22c55e' }}></div>
                    </div>
                  </div>

                  {/* Last activity + unread badge */}
                  <div className="mb-4 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-[var(--text-muted)]">Last message</div>
                      <div className="text-[11px] text-[var(--text-normal)] truncate leading-tight">“{s.lastPreview}”</div>
                    </div>
                    {s.unread > 0 && (
                      <div className="text-[10px] px-1.5 py-px rounded bg-[var(--yellow)]/20 text-[var(--yellow)] font-medium tabular-nums shrink-0">
                        {s.unread} unread
                      </div>
                    )}
                  </div>

                  {/* CTAs */}
                  <div className="mt-auto grid grid-cols-2 gap-2">
                    {p.implemented ? (
                      <>
                        <button 
                          onClick={(e) => { e.stopPropagation(); onOpenPlatform(p.id); }}
                          className="py-2 text-sm font-semibold rounded-[8px] bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white transition active:scale-[0.985]"
                        >
                          Open Inbox
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openFullApp(p.id); }}
                          className="py-2 text-sm font-medium rounded-[8px] border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition active:scale-[0.985]"
                        >
                          Launch full app
                        </button>
                      </>
                    ) : (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onOpenPlatform(p.id); }}
                        className="col-span-2 py-2 text-sm font-medium rounded-[8px] border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition active:scale-[0.985]"
                      >
                        Coming soon — socket ready
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Unified Inbox Teaser */}
      <div 
        onClick={onOpenUnified}
        className="group border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--brand)] rounded-[10px] p-6 flex flex-col md:flex-row gap-5 items-center cursor-pointer transition-all active:scale-[0.995]"
      >
        <div className="flex-1">
          <div className="uppercase text-[10px] tracking-[1.5px] text-[var(--text-muted)] mb-1 font-medium">LIVE</div>
          <div className="text-[21px] font-semibold tracking-tight mb-1 group-hover:text-[var(--brand)] transition-colors">Unified Inbox</div>
          <div className="text-[var(--text-muted)] text-[13px] max-w-md leading-snug">
            Conversations from all platforms in one list — powered by platform transformers. Click to use it now.
          </div>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); onOpenUnified(); }}
          className="shrink-0 px-6 py-[10px] rounded-[9px] bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-sm font-semibold flex items-center gap-2 transition active:scale-[0.985]"
        >
          Open unified inbox <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ====================== UNIFIED INBOX (Transformer / intra-API driven) ======================

type InboxRow = {
  id: string
  platform: 'Telegram' | 'Discord' | 'TikTok' | 'Instagram' | 'Snapchat'
  accountId: string
  accountLabel: string
  name: string
  handle: string
  color: string
  lastMessage: string
  lastMessageAt: string
  unread: number
  archived: boolean
  lastMessageDirection?: 'in' | 'out' | null
}

type ChatMessage = {
  id: string
  from: string
  text: string
  at: string
  sentAt: string
  outgoing?: boolean
}

function mapConversation(conv: OmniConversation, accountLabel?: string): InboxRow {
  const p = conv.platform as keyof typeof PLATFORM_LABEL
  const displayPlatform = PLATFORM_LABEL[p] as InboxRow['platform']
  return {
    id: conv.id,
    platform: displayPlatform,
    accountId: conv.accountId,
    accountLabel: accountLabel || 'Account',
    name: conv.peer.displayName,
    handle: conv.peer.username ? `@${conv.peer.username}` : conv.peer.id,
    color: PLATFORM_COLOR[p],
    lastMessage: conv.lastMessagePreview || '',
    lastMessageAt: conv.lastMessageAt
      ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '',
    unread: conv.unreadCount,
    archived: conv.archived,
    lastMessageDirection: conv.lastMessageDirection,
  }
}

function UnifiedInbox({ 
  pendingPlatformFilter, 
  onFilterConsumed,
  initialQuery,
  refreshKey,
  onOpenCompose,
  pendingSelectedId,
  onSelectedConsumed
}: { 
  pendingPlatformFilter?: PlatformId | null
  onFilterConsumed?: () => void 
  initialQuery?: string
  refreshKey?: number
  onOpenCompose?: () => void
  pendingSelectedId?: string | null
  onSelectedConsumed?: () => void
}) {
  const [conversations, setConversations] = useState<InboxRow[]>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; platform: string; label: string }>>([])
  const [usingDemoUnified, setUsingDemoUnified] = useState(false)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [showAccountFilter, setShowAccountFilter] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState(initialQuery || '')
  const [platformFilter, setPlatformFilter] = useState<'All' | 'Telegram' | 'Discord' | 'TikTok' | 'Instagram' | 'Snapchat' | 'Facebook'>('All')
  const [showArchived, setShowArchived] = useState(false)
  const [showInterestedOnly, setShowInterestedOnly] = useState(false)
  const [showNeedsReply, setShowNeedsReply] = useState(false)
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessage[]>>({})
  const [interestedIds, setInterestedIds] = useState<Set<string>>(new Set())
  const [composer, setComposer] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)

  // Bulk multi-select
  const [isBulkMode, setIsBulkMode] = useState(false)
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set())

  // Load accounts + conversations purely from platform transformers (the intra-API, no seeds)
  useEffect(() => {
    let cancelled = false

    async function loadData() {
      const transformers = getAllTransformers()
      const accList: Array<{ id: string; platform: string; label: string }> = []
      const accMap: Record<string, { label: string; platform: string }> = {}
      const allConvs: OmniConversation[] = []

      // Fetch each platform in parallel with a 5s timeout.
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

      // Accounts and conversations are fetched INDEPENDENTLY per platform — a slow
      // conversations call (e.g. Telegram cache warming) must not drop the whole
      // platform. Inner fn never throws, so every result is fulfilled.
      const platformResults = await Promise.allSettled(transformers.map(async (transformer) => {
        let accs: OmniAccount[] = []
        let convs: OmniConversation[] = []
        try { accs = await withTimeout(transformer.listAccounts(), 8000) }
        catch (e) { console.warn(`[inbox] ${transformer.platform} listAccounts:`, e) }
        try { convs = await withTimeout(transformer.listConversations(), 15000) }
        catch (e) { console.warn(`[inbox] ${transformer.platform} listConversations:`, e) }
        return { transformer, accs, convs }
      }))

      const convOwner: Array<{ transformer: any; conv: OmniConversation }> = []
      for (const result of platformResults) {
        if (result.status !== 'fulfilled') continue
        const { transformer, accs, convs } = result.value
        for (const a of accs) {
          const pLabel = PLATFORM_LABEL[transformer.platform]
          const entry = { id: a.id, platform: pLabel, label: a.label || a.username }
          accList.push(entry)
          accMap[a.id] = { label: entry.label, platform: transformer.platform }
        }
        allConvs.push(...convs)
        for (const c of convs) convOwner.push({ transformer, conv: c })
      }

      if (cancelled) return

      // Render the inbox NOW — don't block on message preloading.
      setAccounts(accList)
      setSelectedAccountIds(accList.map(a => a.id))
      setConversations(allConvs.map((c) => mapConversation(c, accMap[c.accountId]?.label)))
      const hasDemo = accList.some(a => (a.id || '').includes('demo') || (a.label || '').includes('demo'))
      setUsingDemoUnified(hasDemo)

      // Preload recent messages in the BACKGROUND. Skip browser-transport
      // platforms (e.g. TikTok) whose getMessages triggers a live Playwright
      // scrape — those must only fetch on explicit click, never on inbox load.
      const preloadable = convOwner.filter(({ transformer }) =>
        transformer.getCharacteristics?.().transport !== 'browser').slice(0, 30)
      Promise.allSettled(preloadable.map(async ({ transformer, conv }) => {
        const omniMsgs = await withTimeout(transformer.getMessages(conv.id, { limit: 8 }), 4000)
        const uiMsgs: ChatMessage[] = omniMsgs.map(m => ({
          id: m.id,
          from: m.author?.name || (m.direction === 'out' ? 'You' : 'Them'),
          text: m.body || '',
          at: new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          sentAt: m.sentAt,
          outgoing: m.direction === 'out',
        }))
        return { convId: conv.id, uiMsgs }
      })).then(rs => {
        if (cancelled) return
        const preloaded: Record<string, ChatMessage[]> = {}
        for (const r of rs) if (r.status === 'fulfilled') preloaded[r.value.convId] = r.value.uiMsgs
        setMessagesByConv(prev => ({ ...prev, ...preloaded }))
      })
    }

    loadData()
    return () => { cancelled = true }
  }, [])

  // Seed search query coming from header
  useEffect(() => {
    if (initialQuery != null) setQuery(initialQuery)
  }, [initialQuery])

  // React to external refresh (e.g. after unified compose send)
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      reloadConversations()
    }
  }, [refreshKey])

  // Auto-select a newly created conversation (from unified compose)
  useEffect(() => {
    if (pendingSelectedId) {
      setSelectedId(pendingSelectedId)
      onSelectedConsumed?.()
    }
  }, [pendingSelectedId])

  // Apply pending filter from parent (e.g. coming from a Platform card)
  useEffect(() => {
    if (pendingPlatformFilter) {
      const labelMap: Record<PlatformId, 'Telegram' | 'Discord' | 'TikTok' | 'Instagram' | 'Snapchat' | 'Facebook'> = {
        telegram: 'Telegram',
        discord: 'Discord',
        tiktok: 'TikTok',
        instagram: 'Instagram',
        snapchat: 'Snapchat',
        facebook: 'Facebook',
      }
      const pLabel = labelMap[pendingPlatformFilter]
      if (pLabel) {
        setPlatformFilter(pLabel)
      }
      onFilterConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlatformFilter])

  // Reusable reload from transformers (keeps data truth in the source backends)
  async function reloadConversations() {
    const transformers = getAllTransformers()
    const accList: Array<{ id: string; platform: string; label: string }> = []
    const accMap: Record<string, { label: string; platform: string }> = {}
    const allConvs: OmniConversation[] = []

    for (const transformer of transformers) {
      try {
        const accs = await transformer.listAccounts()
        for (const a of accs) {
          const pLabel = PLATFORM_LABEL[transformer.platform]
          accList.push({ id: a.id, platform: pLabel, label: a.label || a.username })
          accMap[a.id] = { label: a.label || a.username, platform: transformer.platform }
        }
        const convs = await transformer.listConversations()
        allConvs.push(...convs)
      } catch {}
    }

    const rows = allConvs.map((c) => {
      const acc = accMap[c.accountId]
      return mapConversation(c, acc?.label)
    })
    // also keep accounts fresh
    setAccounts(accList)
    setConversations(rows)
    const hasDemo = accList.some(a => a.id.includes('demo') || a.label.includes('demo'))
    setUsingDemoUnified(hasDemo)

    // Refresh recent messages cache so deep search and chat history stay fresh after reloads (unified data)
    const freshMsgs: Record<string, ChatMessage[]> = {}
    for (const row of rows) {
      const t = transformers.find(tt => PLATFORM_LABEL[tt.platform] === row.platform)
      if (t) {
        try {
          const omniMsgs = await t.getMessages(row.id, { limit: 8 })
          freshMsgs[row.id] = omniMsgs.map(m => ({
            id: m.id,
            from: m.author?.name || (m.direction === 'out' ? 'You' : 'Them'),
            text: m.body || '',
            at: new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sentAt: m.sentAt,
            outgoing: m.direction === 'out',
          }))
        } catch {}
      }
    }
    setMessagesByConv(freshMsgs)
  }

  // Bulk actions (operate through the platform transformers)
  async function bulkAction(type: 'archive' | 'unarchive' | 'markRead' | 'interested' | 'uninterested') {
    if (bulkIds.size === 0) return

    const transformers = getAllTransformers()
    const ids = Array.from(bulkIds)

    for (const id of ids) {
      const row = conversations.find(c => c.id === id)
      if (!row) continue
      const transformer = transformers.find(t => PLATFORM_LABEL[t.platform] === row.platform)
      if (!transformer) continue

      try {
        if (type === 'archive' || type === 'unarchive') {
          await transformer.archiveConversation(id, type === 'archive')
        } else if (type === 'markRead') {
          await transformer.markRead(id)
          // also clear unread in local row immediately
          setConversations(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c))
        } else if (type === 'interested' || type === 'uninterested') {
          setInterestedIds(prev => {
            const next = new Set(prev)
            if (type === 'interested') next.add(id)
            else next.delete(id)
            return next
          })
        }
      } catch (e) {
        console.warn('Bulk action failed for', id, e)
      }
    }

    // Refresh from transformers
    await reloadConversations()

    // Clear selection
    setBulkIds(new Set())
  }

  function toggleBulk(id: string) {
    setBulkIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearBulk() {
    setBulkIds(new Set())
  }

  const selected = conversations.find(c => c.id === selectedId) || null

  const filtered = conversations
    .filter(c => platformFilter === 'All' || c.platform === platformFilter)
    .filter(c => showArchived ? c.archived : !c.archived)
    .filter(c => selectedAccountIds.length === 0 || selectedAccountIds.includes(c.accountId))
    .filter(c => !showInterestedOnly || interestedIds.has(c.id))
    .filter(c => !showNeedsReply || c.lastMessageDirection === 'in')
    .filter(c => {
      if (!query) return true
      const q = query.toLowerCase()
      const previewMatch = c.name.toLowerCase().includes(q) ||
        c.handle.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q)
      if (previewMatch) return true

      // Deep search in preloaded recent messages for true unified search
      const msgs = messagesByConv[c.id] || []
      return msgs.some(m => (m.text || '').toLowerCase().includes(q))
    })
    .sort((a, b) => {
      const ta = Date.parse(a.lastMessageAt || '') || 0
      const tb = Date.parse(b.lastMessageAt || '') || 0
      return tb - ta
    })

  const currentMessages = selected ? (messagesByConv[selected.id] || []) : []

  function getDateLabel(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const today = now.toDateString()
    if (d.toDateString() === today) return 'Today'
    const yest = new Date(now)
    yest.setDate(yest.getDate() - 1)
    if (d.toDateString() === yest.toDateString()) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const groupedMessages = useMemo(() => {
    if (!currentMessages.length) return [] as { label: string; msgs: ChatMessage[] }[]
    const sorted = [...currentMessages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    const groups: { label: string; msgs: ChatMessage[] }[] = []
    let curLabel = ''
    let cur: ChatMessage[] = []
    sorted.forEach(m => {
      const label = getDateLabel(m.sentAt)
      if (label !== curLabel) {
        if (cur.length) groups.push({ label: curLabel, msgs: cur })
        curLabel = label
        cur = []
      }
      cur.push(m)
    })
    if (cur.length) groups.push({ label: curLabel, msgs: cur })
    return groups
  }, [currentMessages])

  // Auto-scroll to bottom when messages for the selected conv change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [currentMessages])

  // Focus composer when a conversation is selected
  useEffect(() => {
    if (selectedId && composerRef.current) {
      // slight delay to let pane render
      setTimeout(() => composerRef.current?.focus(), 60)
    }
  }, [selectedId])

  async function selectConversation(id: string) {
    setSelectedId(id)

    // Optimistic UI read
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, unread: 0 } : c))
    )

    const conv = conversations.find(c => c.id === id)
    if (!conv) return

    const transformers = getAllTransformers()
    const transformer = transformers.find(t => PLATFORM_LABEL[t.platform] === conv.platform)

    if (transformer) {
      try {
        await transformer.markRead(id)
        const omniMsgs = await transformer.getMessages(id)
        const uiMsgs: ChatMessage[] = omniMsgs.map(m => ({
          id: m.id,
          from: m.author?.name || (m.direction === 'out' ? 'You' : 'Them'),
          text: m.body || '',
          at: new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          sentAt: m.sentAt,
          outgoing: m.direction === 'out',
        }))
        setMessagesByConv(prev => ({
          ...prev,
          [id]: uiMsgs,
        }))
      } catch (e) {
        console.warn('Failed to load messages or mark read via transformer', e)
      }
    }
  }

  // AI draft via the server-side /ai-api endpoint (Cloudflare Workers AI).
  async function draftWithAI() {
    if (!selected) return
    setAiBusy(true)
    try {
      const msgs = (messagesByConv[selected.id] || []).map(m => ({
        direction: m.outgoing ? 'out' : 'in',
        body: m.text,
      }))
      const res = await fetch('/ai-api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversation: { platform: selected.platform, peer: { displayName: selected.name } },
          messages: msgs,
        }),
      })
      const data = await res.json()
      if (data.text) {
        setComposer(data.text)
        setTimeout(() => composerRef.current?.focus(), 30)
      }
    } catch (e) {
      console.warn('AI draft failed', e)
    } finally {
      setAiBusy(false)
    }
  }

  async function sendMessage() {
    if (!selected || !composer.trim()) return

    const text = composer.trim()
    const transformers = getAllTransformers()
    const transformer = transformers.find(t => PLATFORM_LABEL[t.platform] === selected.platform)

    let sentMessage: ChatMessage

    try {
      const omniMsg: OmniMessage = transformer
        ? await transformer.sendMessage(selected.id, text)
        : { id: 'local-' + Date.now(), conversationId: selected.id, platform: 'telegram' as any, direction: 'out', body: text, sentAt: new Date().toISOString() }

      sentMessage = {
        id: omniMsg.id,
        from: 'You',
        text: omniMsg.body || '',
        at: new Date(omniMsg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sentAt: omniMsg.sentAt,
        outgoing: true,
      }
    } catch (e) {
      console.error('Send failed via transformer', e)
      sentMessage = {
        id: 'msg-' + Date.now(),
        from: 'You',
        text,
        at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sentAt: new Date().toISOString(),
        outgoing: true,
      }
    }

    setMessagesByConv(prev => ({
      ...prev,
      [selected.id]: [...(prev[selected.id] || []), sentMessage],
    }))

    // Update local preview immediately
    setConversations(prev =>
      prev.map(c =>
        c.id === selected.id
          ? { ...c, lastMessage: sentMessage.text, lastMessageAt: 'now', unread: 0 }
          : c
      )
    )

    setComposer('')

    // Re-sync full list from transformers (the source of truth lives in the backends)
    await reloadConversations()
  }

  return (
    <div className="flex h-full min-h-[600px] overflow-hidden">
      {/* Conversation List */}
      <div className="w-96 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          {usingDemoUnified && (
            <div className="mb-2 px-2 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-400 rounded">
              Demo data — run the platform backends for live data
            </div>
          )}
          <div className="flex items-center gap-3 mb-3">
            <Inbox className="w-5 h-5 text-[var(--brand)]" />
            <div className="font-semibold text-lg tracking-tight">Unified Inbox</div>
            <button
              onClick={() => onOpenCompose?.()}
              className="ml-2 text-xs px-2 py-0.5 rounded bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
              title="Start new conversation (unified)"
            >
              + New
            </button>
            {query && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--brand)] text-white">filtered by header</span>
            )}
          </div>

          <div className="flex gap-1 mt-2 items-center flex-wrap">
            {(['All', 'Telegram', 'Discord', 'TikTok', 'Instagram', 'Snapchat', 'Facebook'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`text-xs px-2 py-0.5 rounded-md transition ${
                  platformFilter === p
                    ? 'bg-[var(--brand)] text-white'
                    : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-message-hover)]'
                }`}
              >
                {p}
              </button>
            ))}

            <div className="ml-2 flex rounded-md overflow-hidden border border-[var(--border)] text-xs">
              <button
                onClick={() => setShowArchived(false)}
                className={`px-2 py-0.5 ${!showArchived ? 'bg-[var(--bg-message-hover)] font-medium' : 'hover:bg-[var(--bg-tertiary)]'}`}
              >
                Inbox
              </button>
              <button
                onClick={() => setShowArchived(true)}
                className={`px-2 py-0.5 ${showArchived ? 'bg-[var(--bg-message-hover)] font-medium' : 'hover:bg-[var(--bg-tertiary)]'}`}
              >
                Archived
              </button>
            </div>

            <button
              onClick={() => setShowInterestedOnly(!showInterestedOnly)}
              className={`ml-2 text-xs px-2 py-0.5 rounded-md transition border ${showInterestedOnly ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400' : 'border-[var(--border)] hover:bg-[var(--bg-tertiary)]'}`}
            >
              {showInterestedOnly ? '★ Interested' : '☆ Interested'}
            </button>

            <button
              onClick={() => setShowNeedsReply(!showNeedsReply)}
              className={`ml-1 text-xs px-2 py-0.5 rounded-md transition border ${showNeedsReply ? 'bg-orange-500/20 border-orange-500 text-orange-400' : 'border-[var(--border)] hover:bg-[var(--bg-tertiary)]'}`}
            >
              {showNeedsReply ? 'Needs reply' : 'Needs reply'}
            </button>

            <button
              onClick={() => {
                const next = !isBulkMode
                setIsBulkMode(next)
                if (!next) {
                  setBulkIds(new Set())
                }
              }}
              className={`ml-2 text-xs px-2 py-0.5 rounded-md transition border ${isBulkMode ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'border-[var(--border)] hover:bg-[var(--bg-tertiary)]'}`}
            >
              {isBulkMode ? 'Done selecting' : 'Select'}
            </button>

            {/* Account filter — compact dropdown (can be 150+ accounts) */}
            {accounts.length > 0 && (
              <div className="ml-2 relative">
                <button
                  onClick={() => setShowAccountFilter(v => !v)}
                  className="text-xs px-2 py-0.5 rounded-md border border-[var(--border)] hover:bg-[var(--bg-tertiary)]"
                >
                  Accounts: {selectedAccountIds.length === accounts.length ? `All (${accounts.length})` : `${selectedAccountIds.length}/${accounts.length}`} ▾
                </button>
                {showAccountFilter && (
                  <div className="absolute z-30 mt-1 left-0 w-72 max-h-80 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl p-2">
                    <div className="flex gap-3 mb-2 px-1 sticky top-0 bg-[var(--bg-secondary)] pb-1">
                      <button onClick={() => setSelectedAccountIds(accounts.map(a => a.id))} className="text-xs text-[var(--brand)] hover:underline">Select all</button>
                      <button onClick={() => setSelectedAccountIds([])} className="text-xs text-[var(--text-muted)] hover:underline">Clear</button>
                    </div>
                    {accounts.map(acc => {
                      const isSel = selectedAccountIds.includes(acc.id)
                      return (
                        <label key={acc.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => setSelectedAccountIds(prev => isSel ? prev.filter(x => x !== acc.id) : [...prev, acc.id])}
                            className="accent-[var(--brand)]"
                          />
                          <span className="truncate">{acc.platform}: {acc.label}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bulk action bar */}
          {(isBulkMode || bulkIds.size > 0) && (
            <div className="mt-2 flex items-center gap-2 text-xs bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md px-2 py-1">
              <span className="px-1 text-[var(--text-muted)]">{bulkIds.size} selected</span>
              <button onClick={() => bulkAction('markRead')} className="px-2 py-0.5 rounded hover:bg-[var(--bg-message-hover)] border border-[var(--border)]">Mark read</button>
              <button onClick={() => bulkAction('archive')} className="px-2 py-0.5 rounded hover:bg-[var(--bg-message-hover)] border border-[var(--border)]">Archive</button>
              <button onClick={() => bulkAction('unarchive')} className="px-2 py-0.5 rounded hover:bg-[var(--bg-message-hover)] border border-[var(--border)]">Unarchive</button>
              <button onClick={() => bulkAction('interested')} className="px-2 py-0.5 rounded hover:bg-[var(--bg-message-hover)] border border-[var(--border)]">★ Star</button>
              <button onClick={() => bulkAction('uninterested')} className="px-2 py-0.5 rounded hover:bg-[var(--bg-message-hover)] border border-[var(--border)]">☆ Unstar</button>
              <button onClick={clearBulk} className="ml-auto px-2 py-0.5 rounded hover:bg-[var(--bg-message-hover)] text-[var(--text-muted)]">Clear</button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-8 text-center text-[var(--text-muted)] text-sm">No conversations match.</div>
          )}
          {filtered.map(conv => (
            <div
              key={conv.id}
              role="button"
              tabIndex={0}
              onClick={() => selectConversation(conv.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectConversation(conv.id) } }}
              className={`w-full text-left px-4 py-3 border-b border-[var(--border)] flex gap-3 hover:bg-[var(--bg-message-hover)] transition cursor-pointer ${
                selectedId === conv.id ? 'bg-[var(--bg-message-hover)]' : ''
              }`}
            >
              {/* Bulk checkbox */}
              {isBulkMode && (
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleBulk(conv.id)
                  }}
                  className="flex items-center"
                >
                  <input
                    type="checkbox"
                    checked={bulkIds.has(conv.id)}
                    onChange={() => {}} // controlled by parent click
                    className="w-4 h-4 accent-[var(--brand)] cursor-pointer"
                  />
                </div>
              )}

              <div
                className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold ring-1 ring-inset ring-white/10"
                style={{ background: conv.color }}
              >
                {conv.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`font-medium text-sm truncate ${conv.unread > 0 ? 'text-[var(--text-normal)]' : ''}`}>
                    {conv.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setInterestedIds(prev => {
                        const next = new Set(prev)
                        if (next.has(conv.id)) next.delete(conv.id)
                        else next.add(conv.id)
                        return next
                      })
                    }}
                    className={`text-xs ml-1 ${interestedIds.has(conv.id) ? 'text-yellow-400' : 'text-[var(--text-muted)] hover:text-yellow-400'} `}
                  >
                    {interestedIds.has(conv.id) ? '★' : '☆'}
                  </button>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono tabular-nums shrink-0">
                    {conv.lastMessageAt}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span style={{ color: conv.color }} className="font-medium">{conv.platform}</span>
                  {(() => {
                    const t = getTransformer(conv.platform.toLowerCase() as any)
                    const ch = t?.getCharacteristics?.()
                    if (ch) {
                      const col = ch.transport === 'api' ? '#22c55e' : ch.transport === 'hybrid' ? '#eab308' : '#ef4444'
                      return <span style={{color: col}} className="text-[9px] font-mono">[{ch.transport}]</span>
                    }
                    return null
                  })()}
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className="text-[var(--text-muted)]">{conv.accountLabel}</span>
                  <span className="text-[var(--text-muted)] truncate">· {conv.handle}</span>
                </div>
                <div className={`text-[12px] truncate mt-0.5 ${conv.unread > 0 ? 'text-[var(--text-normal)]' : 'text-[var(--text-muted)]'}`}>
                  {conv.lastMessage}
                </div>
              </div>
              {conv.unread > 0 && (
                <div className="mt-1 shrink-0">
                  <div className="min-w-[16px] h-[16px] px-1 text-[9px] leading-[16px] text-center font-bold rounded-full bg-[var(--brand)] text-white">
                    {conv.unread}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Chat Pane */}
      <div className="flex-1 flex flex-col bg-[var(--bg-primary)]">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
            Select a conversation to start messaging across platforms.
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="h-14 px-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ring-1 ring-inset ring-white/10"
                  style={{ background: selected.color }}
                >
                  {selected.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {selected.name}
                    <span 
                      className="text-[10px] px-1.5 py-px rounded font-medium"
                      style={{ backgroundColor: `${selected.color}22`, color: selected.color }}
                    >
                      {selected.platform}
                    </span>
                    {(() => {
                      const t = getTransformer(selected.platform.toLowerCase() as any)
                      const ch = t?.getCharacteristics?.()
                      return ch ? <span className="text-[9px] ml-1 text-[var(--text-muted)]">({ch.transport})</span> : null
                    })()}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {selected.accountLabel} · {selected.handle}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const transformers = getAllTransformers()
                    const transformer = transformers.find(t => PLATFORM_LABEL[t.platform] === selected.platform)
                    if (transformer) {
                      await transformer.archiveConversation(selected.id, !selected.archived)
                      await reloadConversations()
                      setSelectedId(null) // close the pane after archive action
                    }
                  }}
                  className="text-xs px-2 py-1 rounded hover:bg-[var(--bg-tertiary)]"
                >
                  {selected.archived ? 'Unarchive' : 'Archive'}
                </button>
                <div className="text-xs px-3 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                  Unified • {selected.platform}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {groupedMessages.length > 0 ? (
                groupedMessages.map((group, gi) => (
                  <div key={gi}>
                    <div className="text-center my-2">
                      <span className="text-[10px] px-2.5 py-px rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] tracking-wide">
                        {group.label}
                      </span>
                    </div>
                    {group.msgs.map((m, i) => (
                      <div key={i} className={`flex ${m.outgoing ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                            m.outgoing
                              ? 'bg-[var(--brand)] text-white'
                              : 'bg-[var(--bg-secondary)] text-[var(--text-normal)]'
                          }`}
                        >
                          <div className="text-[10px] opacity-70 mb-0.5 flex items-center gap-2">
                            <span>{m.from}</span>
                            <span className="opacity-50">· {m.at}</span>
                          </div>
                          {m.text}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                currentMessages.length === 0 && (
                  <div className="text-[var(--text-muted)] text-sm">No messages yet. Say hello across platforms.</div>
                )
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
              <div className="flex gap-2">
                <input
                  ref={composerRef}
                  value={composer}
                  onChange={e => setComposer(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder={`Message ${selected.name} on ${selected.platform}... (${(() => {
                    const t = getTransformer(selected.platform.toLowerCase() as any)
                    const ch = t?.getCharacteristics?.()
                    return ch ? ch.transport : 'unknown'
                  })()})`}
                  className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
                />
                <button
                  onClick={draftWithAI}
                  disabled={aiBusy}
                  className="px-3 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-tertiary)] text-sm disabled:opacity-50 whitespace-nowrap"
                  title="Draft a reply with AI (Workers AI)"
                >
                  {aiBusy ? '…' : '✨ Draft'}
                </button>
                <button
                  onClick={sendMessage}
                  disabled={!composer.trim()}
                  className="px-4 rounded-lg bg-[var(--brand)] disabled:opacity-50 text-white text-sm font-medium"
                  title={(() => {
                    const t = getTransformer(selected.platform.toLowerCase() as any)
                    const ch = t?.getCharacteristics?.()
                    return ch && ch.transport !== 'api' ? 'May be slower due to ' + ch.transport + ' automation' : ''
                  })()}
                >
                  Send
                </button>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                Sending via {selected.platform} 
                {(() => {
                  const t = getTransformer(selected.platform.toLowerCase() as any)
                  const ch = t?.getCharacteristics?.()
                  return ch ? ` (${ch.transport}, ~${ch.typicalSendLatencyMs}ms)` : ''
                })()}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ====================== PLATFORM VIEW ======================
function PlatformView({ 
  platform, 
  onOpenUnified 
}: { 
  platform: Platform; 
  onOpenUnified?: (id: PlatformId) => void 
}) {
  if (!platform.implemented) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="text-4xl font-semibold tracking-[-1.5px]">{platform.name}</div>
        <div className="text-[var(--text-muted)] mt-2 text-lg">{platform.tagline}</div>
        <div className="mt-6 p-6 border border-[var(--border)] bg-[var(--bg-secondary)] rounded-[10px]">
          <div className="text-xl font-semibold">Socket ready</div>
          <p className="mt-2 text-[var(--text-muted)]">
            {platform.name} support is not implemented yet. A stub transformer is registered so the rest of the system can already reference it.
            When the real adapter is plugged in, this view will come alive.
          </p>
          <button 
            onClick={() => onOpenUnified?.(platform.id)}
            className="mt-4 px-4 py-2 rounded bg-[var(--brand)] text-white text-sm"
          >
            View in Unified Inbox (will show nothing until implemented)
          </button>
        </div>
      </div>
    )
  }

  const [platformConvs, setPlatformConvs] = useState<OmniConversation[]>([])
  const [platformAccs, setPlatformAccs] = useState<OmniAccount[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const transformer = getTransformer(platform.id)
      if (!transformer) return
      try {
        const accs = await transformer.listAccounts()
        const convs = await transformer.listConversations({ archived: false })
        if (!cancelled) {
          setPlatformAccs(accs)
          setPlatformConvs(convs.slice(0, 6))
        }
      } catch {}
    }
    load()
    return () => { cancelled = true }
  }, [platform.id])

  const totalUnread = platformConvs.reduce((n, c) => n + c.unreadCount, 0)

  return (
    <div className="max-w-5xl mx-auto">
      {/* Platform colored header */}
      <div className="platform-header px-8 pt-8 pb-6" style={{ background: `linear-gradient(180deg, ${platform.color}15 0%, transparent 100%)` }}>
        <div className="flex items-center gap-4">
          <div 
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg ring-1 ring-inset ring-white/10" 
            style={{ backgroundColor: platform.color }}
          >
            {platform.icon}
          </div>
          <div>
            <div className="text-4xl font-semibold tracking-[-1.5px]">{platform.name}</div>
            <div className="text-[var(--text-muted)]">{platform.tagline}</div>
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Primary action card */}
          <div className="lg:col-span-3 border border-[var(--border)] bg-[var(--bg-secondary)] rounded-[10px] p-7">
            <div className="uppercase text-[10px] tracking-[2px] text-[var(--text-muted)] mb-2">Quick actions</div>
            <div className="text-[21px] font-semibold tracking-tight mb-5">Jump into {platform.name}</div>
            
            <div className="flex flex-wrap gap-3">
              <button 
                onClick={() => onOpenUnified?.(platform.id)}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-[10px] bg-white text-[#1E1F22] text-sm font-semibold hover:bg-zinc-100 active:scale-[0.985] transition"
              >
                <Inbox className="w-4 h-4" /> Open {platform.name} Inbox
              </button>
              <button
                onClick={() => openFullApp(platform.id)}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-[10px] border border-[var(--border)] hover:bg-[var(--bg-tertiary)] text-sm font-medium transition"
              >
                <ExternalLink className="w-4 h-4" /> Open full app
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 border border-[var(--border)] bg-[var(--bg-secondary)] rounded-[10px] p-7">
            <div className="text-[var(--text-muted)] text-xs mb-2 tracking-widest">CONNECTION</div>
            <div className="flex items-center gap-2 mb-5">
              <div className="status-dot bg-[var(--green)]" />
              <span className="text-[var(--green)] font-medium text-sm">Healthy • {platformAccs.length} accounts</span>
            </div>

            <div className="text-xs space-y-1 text-[var(--text-muted)]">
              <div>{platformConvs.length} active conversations</div>
              <div>{totalUnread} unread</div>
              {(() => {
                const t = getTransformer(platform.id)
                const ch = t?.getCharacteristics?.()
                return ch ? <div className="text-[10px] mt-1">via {ch.transport} • ~{ch.typicalSendLatencyMs || '?'}ms</div> : null
              })()}
            </div>
          </div>
        </div>

        {/* Live conversations for this platform */}
        {platformConvs.length > 0 && (
          <div className="mt-6 border border-[var(--border)] bg-[var(--bg-secondary)] rounded-[10px] p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-widest text-[var(--text-muted)]">Recent conversations (live from transformer)</div>
              <button onClick={() => onOpenUnified?.(platform.id)} className="text-xs text-[var(--brand)] hover:underline">View in unified</button>
            </div>
            <div className="space-y-1 text-sm">
              {platformConvs.map(c => (
                <div key={c.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="font-medium truncate">{c.peer.displayName}</div>
                    <div className="text-[var(--text-muted)] text-xs truncate">@{c.peer.username || c.peer.id}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                    <span className="truncate max-w-[260px]">{c.lastMessagePreview}</span>
                    {c.unreadCount > 0 && <span className="text-[var(--brand)] font-medium">{c.unreadCount} new</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 text-xs text-[var(--text-muted)]">
          {platform.name} runs as its own complete product. OmniDash is the single place where you access and (soon) unify everything.
        </div>
      </div>
    </div>
  )
}

export default App

