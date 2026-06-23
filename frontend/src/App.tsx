import { useState } from 'react'
import { 
  Home, Inbox, Send, Hash, Video, ExternalLink, Search, 
  Bell, ArrowRight 
} from 'lucide-react'
import './App.css'

type PlatformId = 'telegram' | 'discord' | 'tiktok'

interface Platform {
  id: PlatformId
  name: string
  tagline: string
  color: string
  icon: React.ReactNode
}

const PLATFORMS: Platform[] = [
  { 
    id: 'telegram', 
    name: 'Telegram', 
    tagline: 'Messages, groups, channels & campaigns', 
    color: '#229ED9',
    icon: <Send className="w-5 h-5" />
  },
  { 
    id: 'discord', 
    name: 'Discord', 
    tagline: 'Unibox, outreach, warmup & leads', 
    color: '#5865F2',
    icon: <Hash className="w-5 h-5" />
  },
  { 
    id: 'tiktok', 
    name: 'TikTok', 
    tagline: 'DM inbox, pipeline & automation', 
    color: '#FE2C55',
    icon: <Video className="w-5 h-5" />
  },
]

function App() {
  const [activeView, setActiveView] = useState<'home' | 'unified' | PlatformId>('home')

  const currentPlatform = PLATFORMS.find(p => p.id === activeView) as Platform | undefined

  const goHome = () => setActiveView('home')
  const goUnified = () => setActiveView('unified')
  const openPlatform = (id: PlatformId) => setActiveView(id)

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
              badge="Soon"
            />
          </div>

          {/* Platforms */}
          <div className="px-3 mb-1.5 text-[10px] font-medium tracking-[1px] text-[var(--text-muted)]">PLATFORMS</div>
          <div className="space-y-0.5">
            {PLATFORMS.map((platform) => (
              <NavItem 
                key={platform.id}
                icon={<div style={{ color: platform.color }}>{platform.icon}</div>}
                label={platform.name}
                active={activeView === platform.id}
                onClick={() => openPlatform(platform.id)}
              />
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] px-4">
          3 platforms • connected
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
            {currentPlatform && (
              <div 
                className="px-2 py-px text-[10px] rounded font-medium" 
                style={{ backgroundColor: `${currentPlatform.color}22`, color: currentPlatform.color }}
              >
                CONNECTED
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative w-80">
              <Search className="absolute left-3 top-[7px] w-4 h-4 text-[var(--text-muted)]" />
              <input 
                type="text" 
                placeholder="Search all conversations..." 
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg pl-9 pr-4 py-1 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)]"
              />
            </div>

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
          {activeView === 'unified' && <UnifiedInbox />}
          {currentPlatform && <PlatformView platform={currentPlatform} />}
        </div>
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

// ====================== HOME DASHBOARD ======================
function HomeDashboard({ onOpenPlatform, onOpenUnified }: { 
  onOpenPlatform: (id: PlatformId) => void; 
  onOpenUnified: () => void;
}) {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Hero + stats */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-[var(--green)] text-xs font-semibold tracking-[1.5px] mb-1">
          <div className="w-1.5 h-1.5 bg-[var(--green)] rounded-full" /> ALL SYSTEMS OPERATIONAL
        </div>
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-[44px] font-semibold tracking-[-2.6px] leading-none">OmniDash</h1>
            <p className="text-[var(--text-muted)] mt-1 text-[15px]">One place for every conversation across your apps.</p>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm">
            <div>
              <div className="text-[var(--text-muted)] text-xs tracking-widest">TODAY</div>
              <div className="text-2xl font-semibold tabular-nums">147 <span className="text-base font-normal text-[var(--text-muted)]">msgs</span></div>
            </div>
            <div>
              <div className="text-[var(--text-muted)] text-xs tracking-widest">UNREAD</div>
              <div className="text-2xl font-semibold tabular-nums text-[var(--yellow)]">23</div>
            </div>
            <div>
              <div className="text-[var(--text-muted)] text-xs tracking-widest">ACTIVE</div>
              <div className="text-2xl font-semibold tabular-nums">12 <span className="text-base font-normal text-[var(--text-muted)]">threads</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Platforms Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="text-[11px] font-semibold tracking-[1.5px] text-[var(--text-muted)]">YOUR PLATFORMS</div>
          <div className="text-[10px] text-[var(--text-muted)]">3 connected</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLATFORMS.map((p) => (
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
                      <div className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: 'rgba(35,165,90,0.12)', color: 'var(--green)' }}>
                        <div className="status-dot bg-[var(--green)]" />
                        ONLINE
                      </div>
                    </div>
                    <div className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-snug pr-1">{p.tagline}</div>
                  </div>
                </div>

                {/* Stats + account indicators */}
                <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1.5">
                  <div>
                    <span><span className="font-medium text-[var(--text-normal)]">4</span> accounts</span>
                    <span className="text-[var(--border)]"> · </span>
                    <span><span className="font-medium text-[var(--text-normal)]">29</span> conversations</span>
                  </div>
                  <div className="flex -space-x-[1px]">
                    <div className="w-[13px] h-[13px] rounded-full ring-[1.5px] ring-[var(--bg-secondary)]" style={{ background: p.color }}></div>
                    <div className="w-[13px] h-[13px] rounded-full ring-[1.5px] ring-[var(--bg-secondary)]" style={{ background: '#3b82f6' }}></div>
                    <div className="w-[13px] h-[13px] rounded-full ring-[1.5px] ring-[var(--bg-secondary)]" style={{ background: '#22c55e' }}></div>
                  </div>
                </div>

                {/* Last activity */}
                <div className="mb-4">
                  <div className="text-[10px] text-[var(--text-muted)]">Last message</div>
                  <div className="text-[11px] text-[var(--text-normal)] truncate leading-tight">“the campaign is ready to go”</div>
                </div>

                {/* CTAs */}
                <div className="mt-auto grid grid-cols-2 gap-2">
                  <button 
                    onClick={(e) => { e.stopPropagation(); onOpenPlatform(p.id); }}
                    className="py-2 text-sm font-semibold rounded-[8px] bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white transition active:scale-[0.985]"
                  >
                    Open Inbox
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onOpenPlatform(p.id); }}
                    className="py-2 text-sm font-medium rounded-[8px] border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition active:scale-[0.985]"
                  >
                    Launch full app
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Unified Inbox Teaser */}
      <div 
        onClick={onOpenUnified}
        className="group border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--brand)] rounded-[10px] p-6 flex flex-col md:flex-row gap-5 items-center cursor-pointer transition-all active:scale-[0.995]"
      >
        <div className="flex-1">
          <div className="uppercase text-[10px] tracking-[1.5px] text-[var(--text-muted)] mb-1 font-medium">COMING NEXT</div>
          <div className="text-[21px] font-semibold tracking-tight mb-1 group-hover:text-[var(--brand)] transition-colors">Unified Inbox</div>
          <div className="text-[var(--text-muted)] text-[13px] max-w-md leading-snug">
            Conversations from Telegram, Discord and TikTok in one list. Click below to try the live version.
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

// ====================== UNIFIED INBOX ======================
// Note: using local view models for now; will align to Omni* types next

// UI view model (derived from Omni* types)
type InboxRow = {
  id: string
  platform: 'Telegram' | 'Discord' | 'TikTok'
  name: string
  handle: string
  color: string
  lastMessage: string
  lastMessageAt: string
  unread: number
}

type ChatMessage = {
  id: string
  from: string
  text: string
  at: string
  outgoing?: boolean
}

function UnifiedInbox() {
  // Using shapes compatible with the shared Omni* types
  const [conversations, setConversations] = useState<InboxRow[]>([
    { id: 't1', platform: 'Telegram', name: 'Sophia Patel', handle: '@sophia_m', color: '#229ED9', lastMessage: 'Hey, any updates on the proposal we sent last week?', lastMessageAt: '2m', unread: 2 },
    { id: 'd1', platform: 'Discord', name: 'Alex Rivera', handle: 'alexr', color: '#5865F2', lastMessage: 'The server is ready for the campaign. Just added the new leads.', lastMessageAt: '14m', unread: 1 },
    { id: 'tt1', platform: 'TikTok', name: 'Mike Chen', handle: '@creativemike', color: '#FE2C55', lastMessage: 'Loved the last video idea 🔥 When are we posting?', lastMessageAt: '41m', unread: 0 },
    { id: 't2', platform: 'Telegram', name: 'Lina Voss', handle: '@linavoss', color: '#229ED9', lastMessage: 'Can you resend the file? Thanks!', lastMessageAt: '1h', unread: 0 },
  ])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'All' | 'Telegram' | 'Discord' | 'TikTok'>('All')

  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessage[]>>({
    t1: [
      { id: 'm1', from: 'Sophia Patel', text: 'Hey, any updates on the proposal we sent last week?', at: '14:22' },
      { id: 'm2', from: 'You', text: 'Working on it now, should have something by EOD.', at: '14:25', outgoing: true },
    ],
    d1: [
      { id: 'm3', from: 'Alex Rivera', text: 'The server is ready for the campaign. Just added the new leads.', at: '13:58' },
    ],
    tt1: [
      { id: 'm4', from: 'Mike Chen', text: 'Loved the last video idea 🔥 When are we posting?', at: '13:21' },
    ],
    t2: [
      { id: 'm5', from: 'Lina Voss', text: 'Can you resend the file? Thanks!', at: '12:40' },
    ],
  })

  const [composer, setComposer] = useState('')

  const selected = conversations.find(c => c.id === selectedId) || null

  const filtered = conversations
    .filter(c => platformFilter === 'All' || c.platform === platformFilter)
    .filter(c =>
      !query ||
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.handle.toLowerCase().includes(query.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => {
      const ta = parseInt(a.lastMessageAt) || 999
      const tb = parseInt(b.lastMessageAt) || 999
      return ta - tb
    })

  const currentMessages = selected ? (messagesByConv[selected.id] || []) : []

  function selectConversation(id: string) {
    setSelectedId(id)
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, unread: 0 } : c))
    )
  }

  function sendMessage() {
    if (!selected || !composer.trim()) return

    const newMsg: ChatMessage = {
      id: 'm' + Date.now(),
      from: 'You',
      text: composer.trim(),
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      outgoing: true,
    }

    setMessagesByConv(prev => ({
      ...prev,
      [selected.id]: [...(prev[selected.id] || []), newMsg],
    }))

    setConversations(prev =>
      prev.map(c =>
        c.id === selected.id
          ? { ...c, lastMessage: newMsg.text, lastMessageAt: 'now', unread: 0 }
          : c
      )
    )

    setComposer('')
  }

  return (
    <div className="flex h-full min-h-[600px] overflow-hidden">
      {/* Conversation List */}
      <div className="w-96 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 mb-3">
            <Inbox className="w-5 h-5 text-[var(--brand)]" />
            <div className="font-semibold text-lg tracking-tight">Unified Inbox</div>
          </div>

          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)]"
          />

          <div className="flex gap-1 mt-2">
            {(['All', 'Telegram', 'Discord', 'TikTok'] as const).map(p => (
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
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-8 text-center text-[var(--text-muted)] text-sm">No conversations match.</div>
          )}
          {filtered.map(conv => (
            <button
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--border)] flex gap-3 hover:bg-[var(--bg-message-hover)] transition ${
                selectedId === conv.id ? 'bg-[var(--bg-message-hover)]' : ''
              }`}
            >
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
                  <span className="text-[10px] text-[var(--text-muted)] font-mono tabular-nums shrink-0">
                    {conv.lastMessageAt}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span style={{ color: conv.color }} className="font-medium">{conv.platform}</span>
                  <span className="text-[var(--text-muted)] truncate">{conv.handle}</span>
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
            </button>
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
                  <div className="font-medium">{selected.name}</div>
                  <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                    {selected.handle} · <span style={{ color: selected.color }}>{selected.platform}</span>
                  </div>
                </div>
              </div>
              <div className="text-xs text-[var(--text-muted)]">Unified • {selected.platform}</div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {currentMessages.map((m, i) => (
                <div key={i} className={`flex ${m.outgoing ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                      m.outgoing
                        ? 'bg-[var(--brand)] text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-normal)]'
                    }`}
                  >
                    <div className="text-[10px] opacity-70 mb-0.5">{m.from} · {m.at}</div>
                    {m.text}
                  </div>
                </div>
              ))}
              {currentMessages.length === 0 && (
                <div className="text-[var(--text-muted)] text-sm">No messages yet. Say hello across platforms.</div>
              )}
            </div>

            {/* Composer */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
              <div className="flex gap-2">
                <input
                  value={composer}
                  onChange={e => setComposer(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder={`Message ${selected.name} on ${selected.platform}...`}
                  className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
                />
                <button
                  onClick={sendMessage}
                  disabled={!composer.trim()}
                  className="px-4 rounded-lg bg-[var(--brand)] disabled:opacity-50 text-white text-sm font-medium"
                >
                  Send
                </button>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1">Sending via {selected.platform}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ====================== PLATFORM VIEW ======================
function PlatformView({ platform }: { platform: Platform }) {
  const recent = [
    "Just received a reply from the lead list",
    "3 new conversations since this morning",
    "You have 1 unread from yesterday"
  ];

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
                onClick={() => alert(`(Demo) This will open the ${platform.name} inbox view.`)} 
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-[10px] bg-white text-[#1E1F22] text-sm font-semibold hover:bg-zinc-100 active:scale-[0.985] transition"
              >
                <Inbox className="w-4 h-4" /> Open {platform.name} Inbox
              </button>
              <button 
                onClick={() => alert(`(Demo) Launching the standalone ${platform.name} experience.`)} 
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
              <span className="text-[var(--green)] font-medium text-sm">Healthy • 4 accounts</span>
            </div>

            <div className="text-xs space-y-1 text-[var(--text-muted)]">
              <div>Last message: moments ago</div>
              <div>Sync: real-time</div>
            </div>
          </div>
        </div>

        <div className="mt-6 border border-[var(--border)] bg-[var(--bg-secondary)] rounded-[10px] p-6">
          <div className="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-3">Recent activity</div>
          <ul className="text-sm space-y-2 text-[var(--text-normal)]">
            {recent.map((item, i) => (
              <li key={i} className="flex items-start gap-2">• {item}</li>
            ))}
          </ul>
        </div>

        <div className="mt-8 text-xs text-[var(--text-muted)]">
          {platform.name} runs as its own complete product. OmniDash is the single place where you access and (soon) unify everything.
        </div>
      </div>
    </div>
  )
}

export default App

