'use client'

import { useState, useMemo, useEffect } from 'react'
import { useAuth, type GroupPreset, type CreateGroupResult, type CustomFolder } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Users, Loader2, Settings, Folder } from 'lucide-react'
import { PresetManager } from './PresetManager'

export interface SelectedChat {
  id: string
  accountId: string
  chatId: string
  chatTitle?: string
  username?: string | null
}

interface CreateGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedChats: SelectedChat[]
  presets: GroupPreset[]
  folders: CustomFolder[]
  onLoadFolder: (folderId: string) => Promise<SelectedChat[]>
  onCreated: (result: CreateGroupResult) => void
  onPresetsChange: () => void
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  selectedChats,
  presets,
  folders,
  onLoadFolder,
  onCreated,
  onPresetsChange,
}: CreateGroupDialogProps) {
  const { createGroup } = useAuth()
  const [title, setTitle] = useState('')
  const [presetId, setPresetId] = useState('')
  const [extraAdmins, setExtraAdmins] = useState('')
  const [creating, setCreating] = useState(false)
  const [showPresetManager, setShowPresetManager] = useState(false)
  const [folderId, setFolderId] = useState('')
  const [folderCandidates, setFolderCandidates] = useState<SelectedChat[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())
  const [isLoadingFolder, setIsLoadingFolder] = useState(false)

  useEffect(() => {
    if (!open) {
      setFolderId('')
      setFolderCandidates([])
      setSelectedFolderIds(new Set())
    }
  }, [open])

  const allUsers = useMemo(() => {
    const seen = new Set<string>()
    const combined: SelectedChat[] = []
    for (const u of selectedChats) {
      if (!seen.has(u.id)) {
        seen.add(u.id)
        combined.push(u)
      }
    }
    for (const u of folderCandidates) {
      if (selectedFolderIds.has(u.id) && !seen.has(u.id)) {
        seen.add(u.id)
        combined.push(u)
      }
    }
    return combined
  }, [selectedChats, folderCandidates, selectedFolderIds])

  const toggleFolderUser = (id: string) => {
    setSelectedFolderIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleLoadFolder = async () => {
    if (!folderId) { toast.error('Select a folder'); return }
    setIsLoadingFolder(true)
    try {
      const users = await onLoadFolder(folderId)
      if (users.length === 0) { toast.info('No users found in folder'); return }
      setFolderCandidates(users)
      setSelectedFolderIds(new Set(users.map(u => u.id)))
      toast.success(`Loaded ${users.length} user(s) from folder`)
    } catch {
      toast.error('Failed to load folder')
    } finally {
      setIsLoadingFolder(false)
    }
  }

  const clearFolder = () => {
    setFolderCandidates([])
    setSelectedFolderIds(new Set())
    setFolderId('')
  }

  const handleCreate = async () => {
    if (!title.trim()) { toast.error('Enter a group name'); return }
    if (allUsers.length === 0) { toast.error('No users selected'); return }

    setCreating(true)
    try {
      const extraAdminList = extraAdmins
        .split(/\n|,|;/)
        .map(u => u.trim().replace(/^@/, ''))
        .filter(Boolean)

      const result = await createGroup(
        undefined,
        title.trim(),
        allUsers.map(c => ({ account_id: c.accountId, chat_id: c.chatId, username: c.username })),
        presetId || undefined,
        extraAdminList
      )
      toast.success(`Group "${result.title}" created with ${result.members_added} members`)

      const failedMembers = result.members?.filter(m => m.status === 'failed') || []
      if (failedMembers.length > 0) {
        const names = failedMembers.map(m => m.chat_id.slice(0, 8)).join(', ')
        toast.error(`${failedMembers.length} user(s) could not be added: ${names}`)
      }

      if (result.admin_failed.length > 0) {
        toast.error(`Failed to promote admins: ${result.admin_failed.join(', ')}`)
      }
      onCreated(result)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Create Group
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Group Name</label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Enter group name..."
                className="bg-slate-800 border-slate-600 h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">
                Selected Users ({allUsers.length})
              </label>
              <div className="bg-slate-800 rounded max-h-24 overflow-y-auto p-2 text-xs text-slate-300 space-y-1">
                {allUsers.map(c => (
                  <div key={c.id} className="truncate">• {c.chatTitle || c.chatId}</div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium flex items-center gap-1">
                <Folder className="w-3 h-3" /> Load Members from Folder
              </label>
              <div className="flex items-center gap-2">
                <Select value={folderId} onValueChange={v => setFolderId(v)}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 h-9 text-sm flex-1">
                    <SelectValue placeholder="Select a folder" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    {folders.filter(f => f.folder_type !== 'draft').map(f => (
                      <SelectItem key={f.id} value={f.id} className="text-sm">
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-600 h-9 text-xs shrink-0"
                  onClick={handleLoadFolder}
                  disabled={!folderId || isLoadingFolder}
                >
                  {isLoadingFolder ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Load'}
                </Button>
              </div>
              {folderCandidates.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-500">
                      {selectedFolderIds.size} of {folderCandidates.length} selected
                    </span>
                    <button
                      onClick={clearFolder}
                      className="text-[10px] text-rose-400 hover:text-rose-300"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="bg-slate-800 rounded max-h-32 overflow-y-auto p-1 space-y-0.5">
                    {folderCandidates.map(c => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/50 cursor-pointer text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFolderIds.has(c.id)}
                          onChange={() => toggleFolderUser(c.id)}
                          className="accent-blue-500"
                        />
                        <span className="truncate text-slate-300">{c.chatTitle || c.chatId}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400 font-medium">Admin Preset</label>
                <button
                  onClick={() => setShowPresetManager(true)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <Settings className="w-3 h-3" /> Manage
                </button>
              </div>
              <Select value={presetId} onValueChange={v => setPresetId(v === '__none' ? '' : v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 h-9 text-sm">
                  <SelectValue placeholder="No preset" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600 text-white">
                  <SelectItem value="__none" className="text-sm text-slate-400">No preset</SelectItem>
                  {presets.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-sm">
                      {p.name} ({p.admin_usernames.length} admins)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">
                Extra Admin Usernames <span className="text-slate-500">(optional)</span>
              </label>
              <textarea
                value={extraAdmins}
                onChange={e => setExtraAdmins(e.target.value)}
                placeholder="One per line, with or without @"
                rows={3}
                className="w-full rounded bg-slate-800 border border-slate-600 text-sm text-white p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={creating} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating} className="text-xs">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Users className="w-3.5 h-3.5 mr-1" />}
              Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PresetManager
        open={showPresetManager}
        onOpenChange={setShowPresetManager}
        presets={presets}
        onPresetsChange={onPresetsChange}
      />
    </>
  )
}
