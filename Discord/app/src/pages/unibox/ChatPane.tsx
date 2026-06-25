import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Archive, ArrowLeft, CheckCheck, ChevronDown, Hash, Mic, MicOff, Paperclip, RefreshCw, Send, Square, Trash2 } from "lucide-react"
// Wave emoji rendered as text — no lucide icon for it
import { cn } from "@/lib/utils"
import type { Conversation, Message } from "@/api-types"
import type { AccountSummary } from "./store"
import LibraryPanel from "./LibraryPanel"
import {
  avatarColorFromId,
  formatAbsoluteTime,
  formatRelativeTime,
  getInitials,
  isSameMinute,
} from "./utils"

const EXTENSION_ID_KEY = "gg-extension-id"

function activateAccountInExtension(
  accountId: string,
  navigateChannelId?: string,
  onResult?: (r: { ok: boolean; error?: string }) => void,
): { ok: boolean; reason?: string } {
  const extensionId = localStorage.getItem(EXTENSION_ID_KEY) || ""
  if (!extensionId) return { ok: false, reason: "Extension not configured — set it up under /app/sessions." }
  const sessionToken = localStorage.getItem("tg_saas_session") || ""
  const msg = { type: "activate", groupId: `account-${accountId}`, accountId, navigateChannelId, sessionToken }
  try {
    const cr = (window as any).chrome?.runtime
    if (cr?.sendMessage) {
      cr.sendMessage(extensionId, msg, (response: any) => {
        if (cr.lastError) console.warn("[gg] activate failed:", cr.lastError.message)
        else console.log("[gg] activate ok:", response)
        onResult?.(response || { ok: false })
      })
      return { ok: true }
    }
    window.postMessage({ ...msg, type: "gg-activate" }, "*")
    return { ok: true }
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

// ── Attachment body parsing ──────────────────────────────────────────────────
// Body convention written by server and discord-format.ts:
//   [img:URL]          → image attachment
//   [voice:URL]        → voice message
//   [file:NAME:URL]    → generic file
// These tags may appear standalone or after a caption + newline.

interface ParsedBody {
  text: string
  imageUrls: string[]
  voiceUrl: string | null
  fileAttachments: { name: string; url: string }[]
}

function parseBody(raw: string): ParsedBody {
  const imageUrls: string[] = []
  const fileAttachments: { name: string; url: string }[] = []
  let voiceUrl: string | null = null

  const lines = raw.split("\n")
  const textLines: string[] = []

  for (const line of lines) {
    const imgM = line.match(/^\[img:(https?:\/\/[^\]]+)\]$/)
    if (imgM) { imageUrls.push(imgM[1]); continue }

    const voiceM = line.match(/^\[voice:(https?:\/\/[^\]]+)\]$/)
    if (voiceM) { voiceUrl = voiceM[1]; continue }

    const fileM = line.match(/^\[file:([^\]]*?):(https?:\/\/[^\]]+)\]$/)
    if (fileM) { fileAttachments.push({ name: fileM[1], url: fileM[2] }); continue }

    textLines.push(line)
  }

  return { text: textLines.join("\n").trim(), imageUrls, voiceUrl, fileAttachments }
}

// ── Voice recording state machine ───────────────────────────────────────────
type VoicePhase =
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "recording"; startedAt: number; recorder: MediaRecorder; chunks: BlobPart[] }
  | { phase: "recorded"; blob: Blob; durationSecs: number; previewUrl: string }
  | { phase: "sending" }

interface ChatPaneProps {
  conversation: Conversation | null
  account: AccountSummary | null
  messages: Message[]
  loading: boolean
  onSend: (body: string) => Promise<void> | void
  onSendFile?: (file: File) => Promise<void>
  onSendVoice?: (blob: Blob, durationSecs: number) => Promise<void>
  onArchive: () => void
  onDelete: () => void
  onMarkRead: () => void
  onBack?: () => void
}

const STICK_THRESHOLD = 96

export default function ChatPane({
  conversation,
  account,
  messages,
  loading,
  onSend,
  onSendFile,
  onSendVoice,
  onArchive,
  onDelete,
  onMarkRead,
  onBack,
}: ChatPaneProps) {
  const [activateMsg, setActivateMsg] = useState<string | null>(null)
  const doActivate = (accountId: string, navigateChannelId?: string) => {
    const r = activateAccountInExtension(accountId, navigateChannelId)
    setActivateMsg(
      r.ok
        ? navigateChannelId
          ? "✓ Switching Discord tab + opening this chat…"
          : "✓ Switching Discord tab to this account…"
        : `× ${r.reason}`,
    )
    window.setTimeout(() => setActivateMsg(null), 5000)
  }
  const doPrepareAndOpen = (accountId: string, recipientDiscordUserId: string) => {
    const r = prepareAndOpenInExtension(accountId, recipientDiscordUserId)
    setActivateMsg(
      r.ok
        ? "✓ Switching Discord tab + opening all pending DMs for this account from your IP… (this takes a few seconds)"
        : `× ${r.reason}`,
    )
    window.setTimeout(() => setActivateMsg(null), 12000)
  }

  const scrollerRef = useRef<HTMLDivElement>(null)
  const isStickyRef = useRef(true)
  const [, setStickyTick] = useState(0)
  const [composer, setComposer] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [sendingFile, setSendingFile] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [voice, setVoice] = useState<VoicePhase>({ phase: "idle" })
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [recordingSecs, setRecordingSecs] = useState(0)

  useEffect(() => {
    setComposer("")
    setPendingFile(null)
    setSendError(null)
    // Discard any in-progress recording when switching conversation.
    setVoice({ phase: "idle" })
  }, [conversation?.id])

  // Clean up recording timer on unmount.
  useEffect(() => () => { if (recordingTimerRef.current) clearInterval(recordingTimerRef.current) }, [])

  const grouped = useMemo(
    () => groupMessages(messages.filter((m) => m.body.trim() !== "")),
    [messages],
  )

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    if (isStickyRef.current) el.scrollTop = el.scrollHeight
  }, [grouped.length, conversation?.id])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    isStickyRef.current = true
    el.scrollTop = el.scrollHeight
    setStickyTick((t) => t + 1)
  }, [conversation?.id])

  function onScroll() {
    const el = scrollerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nextSticky = distance < STICK_THRESHOLD
    if (nextSticky !== isStickyRef.current) {
      isStickyRef.current = nextSticky
      setStickyTick((t) => t + 1)
    }
  }

  function scrollToBottom() {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    isStickyRef.current = true
    setStickyTick((t) => t + 1)
  }

  const [libraryItems, setLibraryItems] = useState<Array<{ id: string; text_body: string | null; shortcut: string | null }>>([])
  const [waving, setWaving] = useState(false)
  const [waveError, setWaveError] = useState<string | null>(null)

  function handleSend() {
    const trimmed = composer.trim()
    if (!trimmed) return
    setComposer("")
    isStickyRef.current = true
    void onSend(trimmed)
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = send, Shift+Enter = newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (pendingFile && onSendFile) return // let the send button handle file sends
      handleSend()
      return
    }
    // Library shortcuts — match against stored shortcut strings like "ctrl+1"
    if (libraryItems.length > 0 && (e.ctrlKey || e.metaKey || e.altKey)) {
      const pressed = [
        (e.ctrlKey || e.metaKey) ? "ctrl" : null,
        e.altKey ? "alt" : null,
        e.shiftKey ? "shift" : null,
        e.key.toLowerCase(),
      ].filter(Boolean).join("+")
      const match = libraryItems.find((it) => it.shortcut === pressed && it.text_body)
      if (match) {
        e.preventDefault()
        setComposer((prev) => prev ? prev + "\n" + match.text_body! : match.text_body!)
      }
    }
  }

  async function handleWave() {
    setWaving(true); setWaveError(null)
    try {
      const r = await fetch(`/api/unibox/conversations/${conversation.id}/wave`, { method: "POST" })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setWaveError(j?.error || `HTTP ${r.status}`) }
    } catch (e: any) { setWaveError(e?.message || "wave failed") }
    finally { setWaving(false) }
  }

  // ── Voice recording ────────────────────────────────────────────────────────
  async function startRecording() {
    setVoice({ phase: "requesting" })
    setSendError(null)
    // navigator.mediaDevices is undefined on HTTP (non-secure context).
    // Browsers block mic access unless the page is served over HTTPS or localhost.
    if (!navigator.mediaDevices?.getUserMedia) {
      setSendError("Voice recording requires HTTPS. Your browser blocks microphone access on plain HTTP pages.")
      setVoice({ phase: "idle" })
      return
    }
    try {
      // Try default first, then fall back to raw constraints (no echo-cancel etc.)
      // The fallback helps on Windows when another app holds an exclusive audio session
      // that blocks the default DSP pipeline but not the raw device.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (firstErr: any) {
        if (firstErr?.name !== "NotReadableError") throw firstErr;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      }
      const chunks: BlobPart[] = []
      const recorderOpts: MediaRecorderOptions = { audioBitsPerSecond: 128_000 }
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        recorderOpts.mimeType = "audio/webm;codecs=opus"
      }
      const recorder = new MediaRecorder(stream, recorderOpts)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null }
        const elapsed = Math.round((Date.now() - startedAt) / 1000)
        const mimeType = recorder.mimeType || "audio/webm"
        const blob = new Blob(chunks, { type: mimeType })
        const previewUrl = URL.createObjectURL(blob)
        setVoice({ phase: "recorded", blob, durationSecs: elapsed, previewUrl })
      }
      const startedAt = Date.now()
      recorder.start(250)
      setRecordingSecs(0)
      recordingTimerRef.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000)
      setVoice({ phase: "recording", startedAt, recorder, chunks })
    } catch (err: any) {
      // err.name is more reliable than err.message for DOMExceptions across browsers.
      const msg =
        err?.name === "NotAllowedError"  ? "Microphone access denied — allow mic permission in your browser and try again." :
        err?.name === "NotFoundError"    ? "No microphone found — plug one in and try again." :
        err?.name === "NotReadableError" ? "Microphone is in use — close Discord desktop, Zoom, or any other app using the mic, then try again." :
                                          `Mic error: ${err?.message || String(err)}`
      setSendError(msg)
      setVoice({ phase: "idle" })
    }
  }

  function stopRecording() {
    if (voice.phase !== "recording") return
    voice.recorder.stop()
  }

  async function sendVoice() {
    if (voice.phase !== "recorded" || !onSendVoice) return
    const { blob, durationSecs, previewUrl } = voice
    setVoice({ phase: "sending" })
    try {
      await onSendVoice(blob, durationSecs)
      URL.revokeObjectURL(previewUrl)
      setVoice({ phase: "idle" })
      isStickyRef.current = true
    } catch (err: any) {
      setSendError(err?.message || "Failed to send voice message")
      setVoice({ phase: "recorded", blob, durationSecs, previewUrl })
    }
  }

  function discardVoice() {
    if (voice.phase === "recorded") URL.revokeObjectURL(voice.previewUrl)
    if (voice.phase === "recording") { voice.recorder.stop(); return }
    setVoice({ phase: "idle" })
  }

  if (!conversation) return <EmptyState />

  const showScrollPill = !isStickyRef.current
  const peerAvatarBg = avatarColorFromId(conversation.peer.discordUserId)
  const isSystemConv = conversation.peer.discordUserId === "643945264868098049"

  // Is there an active voice interaction (anything other than idle)?
  const voiceActive = voice.phase !== "idle"

  return (
    <section className="flex flex-col bg-bg-primary min-w-0 flex-1">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 h-12 px-3 sm:px-4 border-b border-black/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversation list"
              className="md:hidden -ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-bg-message-hover hover:text-text-normal"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <Hash aria-hidden className="hidden h-5 w-5 text-text-muted shrink-0 sm:block" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-normal truncate">{conversation.peer.displayName}</div>
            <div className="text-[11px] text-text-muted truncate">
              via <span className="text-text-normal">@{account?.username ?? "account"}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {account && (
            <button
              type="button"
              onClick={() => {
                if (conversation.id.startsWith("live_")) doActivate(account.id, conversation.id.slice(5))
                else doActivate(account.id)
              }}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-chip bg-bg-secondary px-2.5 py-1 text-[11px] font-semibold text-text-muted hover:bg-bg-message-hover hover:text-text-normal transition-colors duration-100"
              title={`Open in Discord as @${account.username}`}
            >
              <RefreshCw className="h-3 w-3" /> @{account.username}
            </button>
          )}
          <button type="button" onClick={onMarkRead} className="h-8 w-8 inline-flex items-center justify-center rounded-chip text-text-muted hover:bg-bg-message-hover hover:text-text-normal transition-colors duration-100" title="Mark as read" aria-label="Mark as read">
            <CheckCheck className="h-4 w-4" />
          </button>
          <button type="button" onClick={onArchive} className="h-8 w-8 inline-flex items-center justify-center rounded-chip text-text-muted hover:bg-bg-message-hover hover:text-text-normal transition-colors duration-100" title="Archive conversation" aria-label="Archive conversation">
            <Archive className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDelete} className="h-8 w-8 inline-flex items-center justify-center rounded-chip text-text-muted hover:bg-red/10 hover:text-red transition-colors duration-100" title="Delete conversation" aria-label="Delete conversation">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {activateMsg && (
        <div className={cn("px-4 py-1.5 text-[11px] border-b border-black/20", activateMsg.startsWith("×") ? "text-rose-500 bg-red/5" : "text-emerald-600 dark:text-emerald-300 bg-emerald-500/5")}>
          {activateMsg}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4 relative">
        {loading ? (
          <p className="text-xs text-text-muted">Loading messages…</p>
        ) : grouped.length === 0 ? (
          <ConversationLanding peer={conversation.peer} peerAvatarBg={peerAvatarBg} />
        ) : (
          <ol className="space-y-4">
            {grouped.map((group) => <MessageGroup key={group.id} group={group} />)}
          </ol>
        )}
        {showScrollPill && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-bg-floating text-xs text-text-normal shadow-lg hover:bg-bg-message-hover transition-colors duration-100"
          >
            <ChevronDown className="h-3.5 w-3.5" /> Jump to latest
          </button>
        )}
      </div>

      {/* Composer — hidden for Discord system channels */}
      {isSystemConv && (
        <div className="px-4 py-3 shrink-0 border-t border-black/20 text-center text-[11px] text-text-muted bg-bg-secondary/60">
          This is a Discord system channel — messages cannot be sent here.
        </div>
      )}
      {!isSystemConv && <div className="px-4 pb-4 pt-1 shrink-0">
        {/* CSS for waveform bar animation */}
        <style>{`
          @keyframes voiceBar {
            0%, 100% { height: 4px; }
            50%       { height: 16px; }
          }
        `}</style>

        {sendError && (
          <div className="mb-2 rounded-md border border-red/40 bg-red/10 px-3 py-1.5 text-[11px] text-red flex items-center justify-between">
            <span>{sendError}</span>
            <button type="button" onClick={() => setSendError(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Pending image preview */}
        {pendingFile && !voiceActive && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2">
            {pendingFile.type.startsWith("image/") ? (
              <img src={URL.createObjectURL(pendingFile)} alt="" className="h-12 w-12 rounded object-cover shrink-0" />
            ) : (
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="flex-1 truncate text-[12px] text-foreground">{pendingFile.name}</span>
            <span className="text-[10px] text-muted-foreground">{(pendingFile.size / 1024).toFixed(0)} KB</span>
            <button type="button" onClick={() => setPendingFile(null)} className="text-[11px] text-muted-foreground hover:text-rose-500">remove</button>
          </div>
        )}

        {/* ── Composer bar — transforms into voice UI when recording/recorded ── */}
        <div className="flex items-center gap-2 bg-bg-message-hover rounded-card px-2 py-1.5 min-h-[44px]">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,.gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) { setPendingFile(f); setVoice({ phase: "idle" }) }
              e.target.value = ""
            }}
          />

          {/* ── RECORDING state ── */}
          {voice.phase === "recording" && (
            <>
              {/* Discard */}
              <button
                type="button"
                onClick={discardVoice}
                title="Discard recording"
                className="h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 text-text-muted hover:text-red transition-colors"
              >
                <MicOff className="h-4 w-4" />
              </button>

              {/* Animated waveform + timer */}
              <div className="flex-1 flex items-center gap-2 px-1">
                <span className="h-2 w-2 rounded-full bg-red shrink-0 animate-pulse" />
                <div className="flex items-end gap-[3px] h-5">
                  {[0, 0.15, 0.3, 0.45, 0.6, 0.45, 0.3, 0.15, 0].map((delay, i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-full bg-red/70 inline-block"
                      style={{ animation: `voiceBar 0.7s ease-in-out ${delay}s infinite` }}
                    />
                  ))}
                </div>
                <span className="text-[12px] font-mono text-red ml-1">
                  {String(Math.floor(recordingSecs / 60)).padStart(2, "0")}:{String(recordingSecs % 60).padStart(2, "0")}
                </span>
              </div>

              {/* Stop → goes to recorded */}
              <button
                type="button"
                onClick={stopRecording}
                title="Stop recording"
                className="h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 bg-red text-white hover:brightness-110 transition-colors"
              >
                <Square className="h-4 w-4" fill="currentColor" />
              </button>
            </>
          )}

          {/* ── RECORDED / SENDING state ── */}
          {(voice.phase === "recorded" || voice.phase === "sending") && (
            <>
              {/* Discard */}
              <button
                type="button"
                onClick={discardVoice}
                disabled={voice.phase === "sending"}
                title="Discard"
                className="h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 text-text-muted hover:text-red transition-colors disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              {/* Audio preview */}
              <audio
                src={voice.previewUrl}
                controls
                className="flex-1 h-8 min-w-0"
                style={{ colorScheme: "dark" }}
              />

              {/* Duration */}
              <span className="text-[11px] font-mono text-text-muted shrink-0">
                {String(Math.floor(voice.durationSecs / 60)).padStart(2, "0")}:{String(voice.durationSecs % 60).padStart(2, "0")}
              </span>

              {/* Send */}
              <button
                type="button"
                onClick={sendVoice}
                disabled={voice.phase === "sending" || !onSendVoice}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50"
                title="Send voice message"
              >
                {voice.phase === "sending"
                  ? <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  : <Send className="h-4 w-4" />
                }
              </button>
            </>
          )}

          {/* ── REQUESTING state ── */}
          {voice.phase === "requesting" && (
            <div className="flex-1 flex items-center gap-2 px-2 text-[12px] text-text-muted">
              <span className="h-3 w-3 rounded-full border-2 border-text-muted border-t-transparent animate-spin shrink-0" />
              Requesting microphone…
            </div>
          )}

          {/* ── IDLE state — normal composer ── */}
          {voice.phase === "idle" && (
            <>
              {/* Paperclip */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach image"
                className={cn("h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 transition-colors", pendingFile ? "text-brand" : "text-text-muted hover:text-text-normal")}
              >
                <Paperclip className="h-4 w-4" />
              </button>

              {/* Textarea */}
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder={pendingFile ? "Caption (optional)" : `Message ${conversation.peer.displayName}`}
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm text-text-normal placeholder:text-text-muted focus:outline-none py-2 max-h-40"
              />

              <LibraryPanel
                onInsertText={(text) => setComposer((prev) => prev ? prev + "\n" + text : text)}
                onItemsLoaded={setLibraryItems}
                onSendImageUrl={async (url, caption) => {
                  if (onSendFile) {
                    try {
                      const resp = await fetch(url)
                      const blob = await resp.blob()
                      const ext = url.split('.').pop()?.split('?')[0] || 'jpg'
                      await onSendFile(new File([blob], `image.${ext}`, { type: blob.type }))
                      if (caption && onSend) await onSend(caption)
                      return
                    } catch {}
                  }
                  if (onSend) onSend(caption ? `${caption}\n${url}` : url)
                }}
              />

              {/* Wave button */}
              {!pendingFile && !composer.trim() && (
                <button
                  type="button"
                  onClick={handleWave}
                  disabled={waving}
                  title={waveError ?? "Send wave"}
                  className={cn(
                    "h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 text-[16px] transition-colors",
                    waveError ? "text-red" : waving ? "opacity-50" : "text-text-muted hover:text-text-normal",
                  )}
                >
                  {waving ? <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> : "👋"}
                </button>
              )}

              {/* Mic button (idle → start recording) */}
              {!pendingFile && onSendVoice && !composer.trim() && (
                <button
                  type="button"
                  onClick={startRecording}
                  title="Record voice message"
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 text-text-muted hover:text-text-normal transition-colors"
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}

              {/* Send button (only when there's text or a file) */}
              {(composer.trim() || pendingFile) && (
                <button
                  type="button"
                  onClick={async () => {
                    setSendError(null)
                    if (pendingFile && onSendFile) {
                      setSendingFile(true)
                      try { await onSendFile(pendingFile) } catch (err: any) { setSendError(err?.message || "Upload failed") } finally { setSendingFile(false); setPendingFile(null) }
                    } else {
                      handleSend()
                    }
                  }}
                  disabled={sendingFile}
                  className={cn(
                    "h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 transition-colors duration-100",
                    sendingFile ? "bg-bg-tertiary text-text-muted cursor-not-allowed" : "bg-brand text-white hover:bg-brand-hover",
                  )}
                  aria-label="Send"
                  title="Send (Enter)"
                >
                  {sendingFile
                    ? <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    : <Send className="h-4 w-4" />
                  }
                </button>
              )}
            </>
          )}
        </div>{/* end composer bar */}
        <p className="text-[10px] text-text-muted mt-1 px-1">
          {voice.phase === "idle"
            ? <>Enter to send · Shift+Enter for newline · via <span className="text-text-normal">@{account?.username ?? "account"}</span></>
            : voice.phase === "recording"
            ? <span className="text-red">Recording — tap ■ to stop</span>
            : voice.phase === "recorded"
            ? <span className="text-text-muted">Preview above — tap send or discard</span>
            : null
          }
        </p>
      </div>}
    </section>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <section className="flex-1 bg-bg-primary flex items-center justify-center min-w-0">
      <div className="text-center max-w-sm px-6">
        <div aria-hidden className="mx-auto h-20 w-20 rounded-full bg-bg-secondary flex items-center justify-center text-brand">
          <Hash className="h-10 w-10" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-text-normal">Pick a conversation</h2>
        <p className="mt-2 text-sm text-text-muted">
          Threads land here the moment a friend request is accepted across any of your bridged accounts. Your unibox is unified — same view, every identity.
        </p>
      </div>
    </section>
  )
}

function ConversationLanding({ peer, peerAvatarBg }: { peer: Conversation["peer"]; peerAvatarBg: string }) {
  return (
    <div className="py-8">
      <div className="h-16 w-16 rounded-full flex items-center justify-center text-white text-xl font-semibold" style={{ backgroundColor: peer.avatarUrl ? undefined : peerAvatarBg }}>
        {peer.avatarUrl ? <img src={peer.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : getInitials(peer.displayName)}
      </div>
      <h3 className="mt-3 text-xl font-bold text-text-normal">{peer.displayName}</h3>
      <p className="mt-1 text-sm text-text-muted">
        This is the start of your direct message history with <span className="text-text-normal">{peer.displayName}</span>.
      </p>
    </div>
  )
}

interface MsgGroup {
  id: string
  authorName: string
  authorAvatarUrl: string | null
  authorKey: string
  direction: "in" | "out"
  firstSentAt: string
  messages: Message[]
}

function groupMessages(messages: Message[]): MsgGroup[] {
  const groups: MsgGroup[] = []
  for (const m of messages) {
    const last = groups[groups.length - 1]
    const sameSender =
      last &&
      last.direction === m.direction &&
      last.authorName === m.authorName &&
      isSameMinute(last.messages[last.messages.length - 1]!.sentAt, m.sentAt)
    if (sameSender) {
      last!.messages.push(m)
    } else {
      groups.push({
        id: `${m.direction}-${m.id}`,
        authorName: m.authorName,
        authorAvatarUrl: m.authorAvatarUrl,
        authorKey: `${m.direction}:${m.authorName}`,
        direction: m.direction,
        firstSentAt: m.sentAt,
        messages: [m],
      })
    }
  }
  return groups
}

// ── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({ body, isOut }: { body: string; isOut: boolean }) {
  const parsed = parseBody(body)
  const bubbleClass = isOut
    ? "px-3 py-1.5 rounded-card bg-brand/85 text-white text-sm whitespace-pre-wrap break-words"
    : "px-3 py-1.5 rounded-card bg-bg-secondary text-sm text-text-normal whitespace-pre-wrap break-words"

  return (
    <div className="flex flex-col gap-1">
      {/* Text portion (caption or body) */}
      {parsed.text && <div className={bubbleClass}>{parsed.text}</div>}

      {/* Image attachments */}
      {parsed.imageUrls.map((url, i) => (
        <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt="attachment"
            className="max-w-[280px] max-h-[320px] rounded-card object-cover cursor-pointer hover:opacity-90 transition-opacity"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        </a>
      ))}

      {/* Voice message */}
      {parsed.voiceUrl && (
        <div className={cn("flex items-center gap-2 rounded-card px-3 py-2", isOut ? "bg-brand/85" : "bg-bg-secondary")}>
          <Mic className={cn("h-4 w-4 shrink-0", isOut ? "text-white/70" : "text-text-muted")} />
          <audio
            src={`/api/proxy-audio?url=${encodeURIComponent(parsed.voiceUrl)}`}
            controls
            className="h-8 flex-1 min-w-0"
            style={{ colorScheme: "dark" }}
          />
        </div>
      )}

      {/* Generic file attachments */}
      {parsed.fileAttachments.map((f, i) => (
        <a
          key={i}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          className={cn("flex items-center gap-2 rounded-card px-3 py-2 text-[12px] hover:opacity-80", isOut ? "bg-brand/85 text-white" : "bg-bg-secondary text-text-normal")}
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{f.name}</span>
          <span className="ml-auto text-[10px] opacity-60">↓</span>
        </a>
      ))}
    </div>
  )
}

function MessageGroup({ group }: { group: MsgGroup }) {
  if (group.direction === "out") {
    return (
      <li>
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-text-muted">{formatRelativeTime(group.firstSentAt)}</span>
            <span className="text-xs font-semibold text-text-normal">You</span>
          </div>
          <div className="flex flex-col items-end gap-1 max-w-[75%]">
            {group.messages.map((m) => (
              <div key={m.id} title={formatAbsoluteTime(m.sentAt)}>
                <MessageBubble body={m.body} isOut={true} />
              </div>
            ))}
          </div>
        </div>
      </li>
    )
  }

  const avatarBg = avatarColorFromId(group.authorKey)
  return (
    <li>
      <div className="flex items-start gap-3">
        <div
          className="h-9 w-9 rounded-full overflow-hidden flex items-center justify-center text-white text-xs font-semibold shrink-0"
          style={{ backgroundColor: group.authorAvatarUrl ? undefined : avatarBg }}
        >
          {group.authorAvatarUrl ? <img src={group.authorAvatarUrl} alt="" className="h-full w-full object-cover" /> : getInitials(group.authorName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-normal">{group.authorName}</span>
            <span className="text-[11px] text-text-muted">{formatRelativeTime(group.firstSentAt)}</span>
          </div>
          <div className="flex flex-col gap-1 mt-0.5 max-w-[75%]">
            {group.messages.map((m) => (
              <div key={m.id} title={formatAbsoluteTime(m.sentAt)}>
                <MessageBubble body={m.body} isOut={false} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </li>
  )
}
