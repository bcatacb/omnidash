'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { AuthGuard } from '@/components/auth-guard'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { useAuth, type StoredMessage } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  Bookmark,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/confirm-dialog'

export default function StoredMessagesPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const {
    listStoredMessages,
    createStoredMessage,
    deleteStoredMessage,
    getStoredMessageFileUrl,
  } = useAuth()
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await listStoredMessages()
      setMessages(res.messages)
    } catch (e: any) {
      toast.error(e.message || 'Failed to load stored messages')
    } finally {
      setLoading(false)
    }
  }, [listStoredMessages])

  useEffect(() => { load() }, [load])

  const selected = messages.find((m) => m.id === selectedId) ?? null

  const handleSubmit = async () => {
    if (!text.trim() && !file) {
      toast.error('Enter text or select a file')
      return
    }
    setSubmitting(true)
    try {
      await createStoredMessage({ text: text.trim() || undefined, file: file || undefined })
      setText('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await load()
      toast.success('Message stored')
    } catch (e: any) {
      toast.error(e.message || 'Failed to store message')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteStoredMessage(deleteId)
      if (selectedId === deleteId) setSelectedId(null)
      await load()
      toast.success('Message deleted')
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete message')
    } finally {
      setDeleteId(null)
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <AuthGuard>
      <div className="flex h-screen bg-slate-900">
        <DashboardSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0">
          <DashboardHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
          <div className="flex-1 flex overflow-hidden">
            {/* Left panel — list */}
            <div className="w-80 border-r border-slate-800 flex flex-col">
              <div className="p-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-gray-300">All Messages</h2>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex justify-center py-8"><Spinner /></div>
                ) : messages.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-8">No stored messages yet</p>
                ) : (
                  messages.map((msg) => (
                    <button
                      key={msg.id}
                      onClick={() => setSelectedId(msg.id)}
                      className={`w-full text-left px-3 py-3 border-b border-slate-800 hover:bg-slate-800/50 transition flex items-start gap-3 ${
                        selectedId === msg.id ? 'bg-slate-800' : ''
                      }`}
                    >
                      <div className="mt-0.5">
                        {msg.type === 'text' ? (
                          <FileText className="w-4 h-4 text-blue-400" />
                        ) : msg.type === 'photo' ? (
                          <ImageIcon className="w-4 h-4 text-green-400" />
                        ) : (
                          <Paperclip className="w-4 h-4 text-yellow-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-200 truncate">
                          {msg.type === 'text' ? msg.content : msg.fileName || msg.content}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatDate(msg.createdAt)}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right panel — detail/add */}
            <div className="flex-1 flex flex-col overflow-y-auto">
              {selected ? (
                <div className="p-6 flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-200">
                      {selected.type === 'text' ? 'Text Message' : selected.fileName || selected.content}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteId(selected.id)}>
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>

                  {selected.type === 'text' ? (
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-gray-200 whitespace-pre-wrap">{selected.content}</p>
                    </div>
                  ) : selected.type === 'photo' ? (
                    <div className="bg-slate-800 rounded-lg p-2">
                      <img
                        src={getStoredMessageFileUrl(selected.id)}
                        alt={selected.fileName || 'Stored photo'}
                        className="max-w-full max-h-96 rounded object-contain"
                      />
                    </div>
                  ) : (
                    <div className="bg-slate-800 rounded-lg p-4 flex items-center gap-3">
                      <Paperclip className="w-6 h-6 text-yellow-400" />
                      <div>
                        <p className="text-gray-200">{selected.fileName || selected.content}</p>
                        {selected.fileSize != null && (
                          <p className="text-xs text-gray-500">
                            {(selected.fileSize / 1024).toFixed(1)} KB
                          </p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() => window.open(getStoredMessageFileUrl(selected.id), '_blank')}
                      >
                        Download
                      </Button>
                    </div>
                  )}

                  <p className="text-xs text-gray-500 mt-4">
                    Stored {formatDate(selected.createdAt)}
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Bookmark className="w-12 h-12 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Select a message or create a new one</p>
                  </div>
                </div>
              )}

              {/* Add form */}
              <div className="border-t border-slate-800 p-4">
                <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  New Stored Message
                </h4>
                <div className="space-y-3">
                  <Textarea
                    placeholder="Type your message text..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    className="bg-slate-800 border-slate-700 text-gray-200 resize-none"
                  />
                  <div className="flex items-center gap-3">
                    <input
                      ref={fileRef}
                      type="file"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="text-sm text-gray-400 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-slate-700 file:text-gray-200 hover:file:bg-slate-600"
                    />
                    {file && (
                      <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }}>
                        <X className="w-4 h-4 text-gray-400 hover:text-red-400" />
                      </button>
                    )}
                  </div>
                  <Button onClick={handleSubmit} disabled={submitting || (!text.trim() && !file)}>
                    {submitting ? <Spinner /> : 'Store Message'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={deleteId != null}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Stored Message"
        description="Are you sure you want to delete this stored message?"
        onConfirm={handleDelete}
      />
    </AuthGuard>
  )
}
