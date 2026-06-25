import { useEffect, useRef, useState } from "react"
import { BookOpen, Image, MessageSquare, Plus, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface LibraryItem {
  id: string
  title: string | null
  text_body: string | null
  image_urls: string[]
  shortcut: string | null
}

interface LibraryPanelProps {
  onInsertText: (text: string) => void
  onSendImageUrl: (url: string, caption?: string) => void
  onItemsLoaded?: (items: LibraryItem[]) => void
}

export default function LibraryPanel({ onInsertText, onSendImageUrl, onItemsLoaded }: LibraryPanelProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newText, setNewText] = useState("")
  const [newShortcut, setNewShortcut] = useState("")
  const [newImageFiles, setNewImageFiles] = useState<{ preview: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Eager load on mount so items are ready when the panel first opens.
  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) { setItems(d); setLoaded(true); onItemsLoaded?.(d) } })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    // Refresh list whenever panel opens (picks up any external adds).
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) { setItems(d); onItemsLoaded?.(d) } })
      .catch(() => {})
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setNewImageFiles((prev) => [...prev, { preview: ev.target!.result as string, name: file.name }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ""
  }

  const removeFile = (idx: number) => setNewImageFiles((prev) => prev.filter((_, i) => i !== idx))

  const save = async () => {
    if (!newText.trim() && newImageFiles.length === 0) return
    setSaving(true)
    try {
      const imageUrls: string[] = []
      for (const { preview } of newImageFiles) {
        const r = await fetch("/api/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: preview }),
        })
        const j = await r.json()
        if (r.ok && j.url) imageUrls.push(j.url)
      }
      const r = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim() || undefined,
          text_body: newText.trim() || undefined,
          image_urls: imageUrls,
          shortcut: newShortcut.trim().toLowerCase() || undefined,
        }),
      })
      const j = await r.json()
      if (r.ok) {
        setItems((prev) => { const next = [j, ...prev]; onItemsLoaded?.(next); return next })
        setNewTitle(""); setNewText(""); setNewShortcut(""); setNewImageFiles([]); setAdding(false)
      }
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    await fetch(`/api/library/${id}`, { method: "DELETE" }).catch(() => {})
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Content library"
        className={cn(
          "h-9 w-9 inline-flex items-center justify-center rounded-full shrink-0 transition-colors",
          open ? "text-brand" : "text-text-muted hover:text-text-normal",
        )}
      >
        <BookOpen className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute bottom-12 right-0 z-30 w-80 rounded-xl border border-input bg-bg-floating shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-input px-3 py-2">
            <span className="text-[12px] font-semibold text-foreground">Content Library</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-0.5 rounded-chip bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/25"
              >
                <Plus className="h-3 w-3" /> New
              </button>
              <button type="button" onClick={() => setOpen(false)} className="ml-1 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Add form */}
          {adding && (
            <div className="border-b border-input bg-muted/30 p-3 space-y-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-[12px]"
              />
              <textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Message text…"
                rows={3}
                className="w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-[12px]"
              />
              <input
                value={newShortcut}
                onChange={(e) => setNewShortcut(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") return
                  e.preventDefault()
                  const parts: string[] = []
                  if (e.ctrlKey || e.metaKey) parts.push("ctrl")
                  if (e.altKey) parts.push("alt")
                  if (e.shiftKey) parts.push("shift")
                  const k = e.key.toLowerCase()
                  if (k.length === 1 || (k.length > 1 && k.startsWith("f") && !isNaN(Number(k.slice(1))))) parts.push(k)
                  if (parts.length > 1) setNewShortcut(parts.join("+"))
                }}
                placeholder="Shortcut (e.g. Ctrl+1) — press keys"
                readOnly
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-[12px] cursor-pointer"
              />
              {/* Multi-image file picker */}
              <div className="space-y-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded-md border border-dashed border-input bg-background px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-brand w-full justify-center"
                >
                  <Image className="h-3.5 w-3.5" /> Add images from device
                </button>
                {newImageFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {newImageFiles.map((f, idx) => (
                      <div key={idx} className="group relative h-14 w-14 shrink-0 rounded-md overflow-hidden border border-input bg-muted">
                        <img src={f.preview} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeFile(idx)}
                          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3.5 w-3.5 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setAdding(false); setNewImageFiles([]) }} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || (!newText.trim() && newImageFiles.length === 0)}
                  className="rounded-chip bg-brand px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {saving ? (newImageFiles.length > 0 ? "Uploading…" : "Saving…") : "Save"}
                </button>
              </div>
            </div>
          )}

          {/* Items */}
          <ul className="max-h-72 overflow-y-auto divide-y divide-input/50">
            {items.length === 0 && (
              <li className="px-3 py-5 text-center text-[11px] text-muted-foreground">
                {loaded ? "No items yet. Add promotions, big pots, or any reusable content." : "Loading…"}
              </li>
            )}
            {items.map((item) => (
              <li key={item.id} className="group flex items-start gap-2 px-3 py-2.5 hover:bg-muted/40">
                <div className="mt-0.5 shrink-0 text-muted-foreground">
                  {item.image_urls.length > 0 && !item.text_body ? <Image className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {item.title && <div className="text-[11px] font-semibold text-foreground truncate">{item.title}</div>}
                    {item.shortcut && (
                      <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground border border-input">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                  {item.text_body && (
                    <button
                      type="button"
                      onClick={() => { onInsertText(item.text_body!); setOpen(false) }}
                      className="mt-0.5 block w-full text-left text-[11px] text-muted-foreground line-clamp-2 hover:text-foreground"
                    >
                      {item.text_body}
                    </button>
                  )}

                  {item.image_urls.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {item.image_urls.map((url) => (
                        <div key={url} className="flex flex-col gap-0.5">
                          <img
                            src={url}
                            alt=""
                            className="h-16 w-16 rounded object-cover border border-input"
                            onError={(e) => (e.currentTarget.style.display = "none")}
                          />
                          <button
                            type="button"
                            onClick={() => { onSendImageUrl(url, item.title || undefined); setOpen(false) }}
                            className="text-[10px] text-brand hover:underline text-center"
                          >
                            Send
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="invisible group-hover:visible mt-0.5 shrink-0 text-muted-foreground hover:text-rose-500"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
