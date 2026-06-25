'use client'

import { useState } from 'react'
import { useAuth, type GroupPreset } from '@/lib/auth-context'
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
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface PresetManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  presets: GroupPreset[]
  onPresetsChange: () => void
}

export function PresetManager({ open, onOpenChange, presets, onPresetsChange }: PresetManagerProps) {
  const { createGroupPreset, updateGroupPreset, deleteGroupPreset } = useAuth()
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [usernames, setUsernames] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const resetForm = () => {
    setName('')
    setUsernames('')
    setIsAdding(false)
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Preset name is required'); return }
    const list = usernames.split(/\n|,|;/).map(u => u.trim().replace(/^@/, '')).filter(Boolean)
    if (list.length === 0) { toast.error('At least one admin username is required'); return }
    setSaving(true)
    try {
      if (editingId) {
        await updateGroupPreset(editingId, { name: name.trim(), admin_usernames: list })
        toast.success('Preset updated')
      } else {
        await createGroupPreset(name.trim(), list)
        toast.success('Preset created')
      }
      resetForm()
      onPresetsChange()
    } catch { toast.error('Failed to save preset') }
    finally { setSaving(false) }
  }

  const handleEdit = (p: GroupPreset) => {
    setEditingId(p.id)
    setName(p.name)
    setUsernames(p.admin_usernames.join('\n'))
    setIsAdding(true)
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteGroupPreset(deleteId)
      toast.success('Preset deleted')
      onPresetsChange()
    } catch { toast.error('Failed to delete preset') }
    finally { setDeleteId(null) }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v) }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Admin Presets</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-auto">
            {presets.length === 0 && !isAdding && (
              <p className="text-sm text-slate-400 text-center py-4">No presets yet</p>
            )}
            {presets.map(p => (
              <div key={p.id} className="flex items-center justify-between bg-slate-800 rounded px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-slate-400 truncate">{p.admin_usernames.map(u => `@${u}`).join(', ')}</p>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <button onClick={() => handleEdit(p)} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setDeleteId(p.id)} className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-slate-700">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {isAdding && (
              <div className="bg-slate-800 rounded p-3 space-y-2">
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Preset name"
                  className="bg-slate-700 border-slate-600 h-8 text-sm"
                />
                <textarea
                  value={usernames}
                  onChange={e => setUsernames(e.target.value)}
                  placeholder="Admin usernames (one per line, with or without @)"
                  rows={4}
                  className="w-full rounded bg-slate-700 border-slate-600 text-sm text-white p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetForm} className="h-7 text-xs">Cancel</Button>
                  <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                    {editingId ? 'Update' : 'Create'}
                  </Button>
                </div>
              </div>
            )}
          </div>
          {!isAdding && (
            <DialogFooter>
              <Button size="sm" onClick={() => setIsAdding(true)} className="text-xs">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Preset
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Preset"
        description="Are you sure you want to delete this preset?"
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </>
  )
}
