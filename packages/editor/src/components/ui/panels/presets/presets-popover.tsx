'use client'

import { useEffect, useState, useCallback } from 'react'
import { BookMarked, Check, Globe, GlobeLock, MoreHorizontal, Pencil, Plus, Save, Trash2, Users, X } from 'lucide-react'
import { emitter } from '@pascal-app/core'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../primitives/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'
import { cn } from '../../../../lib/utils'
import type { PresetsTab } from '../../../../contexts/presets-context'

export type PresetType = 'door' | 'window'

export interface PresetData {
  id: string
  type: string
  name: string
  data: Record<string, unknown>
  thumbnail_url: string | null
  user_id: string | null
  is_community: boolean
  created_at: string
}

interface PresetsPopoverProps {
  type: PresetType
  children: React.ReactNode
  isAuthenticated?: boolean
  tabs?: PresetsTab[]
  onFetchPresets: (tab: PresetsTab) => Promise<PresetData[]>
  onApply: (data: Record<string, unknown>) => void
  onSave: (name: string) => Promise<void>
  onOverwrite: (id: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToggleCommunity?: (id: string, current: boolean) => Promise<void>
}

export function PresetsPopover({
  type,
  onApply,
  onSave,
  onOverwrite,
  onFetchPresets,
  onRename,
  onDelete,
  onToggleCommunity,
  children,
  isAuthenticated = false,
  tabs = ['community', 'mine'],
}: PresetsPopoverProps) {
  const defaultTab = tabs[0] ?? 'mine'
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<PresetsTab>(defaultTab)
  const [presets, setPresets] = useState<PresetData[]>([])
  const [loading, setLoading] = useState(false)

  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [overwrittenId, setOverwrittenId] = useState<string | null>(null)

  const fetchPresets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await onFetchPresets(tab)
      setPresets(data)
    } finally {
      setLoading(false)
    }
  }, [onFetchPresets, tab])

  useEffect(() => {
    if (open) fetchPresets()
  }, [open, fetchPresets])

  useEffect(() => {
    if (!isAuthenticated && tab === 'mine') setTab(defaultTab)
  }, [isAuthenticated, tab, defaultTab])

  useEffect(() => {
    const handler = ({ presetId, thumbnailUrl }: { presetId: string; thumbnailUrl: string }) => {
      setPresets((prev) =>
        prev.map((p) => (p.id === presetId ? { ...p, thumbnail_url: thumbnailUrl } : p)),
      )
    }
    emitter.on('preset:thumbnail-updated', handler)
    return () => emitter.off('preset:thumbnail-updated', handler)
  }, [])

  const handleSaveNew = async () => {
    if (!saveName.trim()) return
    setSaving(true)
    try {
      await onSave(saveName.trim())
      setSaveName('')
      setShowSaveInput(false)
      if (tab === 'mine') fetchPresets()
      else setTab('mine')
    } finally {
      setSaving(false)
    }
  }

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) return
    await onRename(id, renameValue.trim())
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, name: renameValue.trim() } : p)))
    setRenamingId(null)
  }

  const handleDelete = async (id: string) => {
    await onDelete(id)
    setPresets((prev) => prev.filter((p) => p.id !== id))
    setDeletingId(null)
  }

  const handleOverwrite = async (id: string) => {
    await onOverwrite(id)
    setOverwrittenId(id)
    setTimeout(() => setOverwrittenId(null), 1500)
  }

  const handleToggleCommunity = async (id: string, current: boolean) => {
    if (!onToggleCommunity) return
    await onToggleCommunity(id, current)
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, is_community: !current } : p)))
  }

  const showTabs = tabs.length > 1

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-72 p-0 border-border/50 bg-sidebar/95 backdrop-blur-xl shadow-2xl rounded-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <BookMarked className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground tracking-tight">
              {type === 'door' ? 'Door' : 'Window'} Presets
            </span>
          </div>
          {isAuthenticated && (
            <button
              type="button"
              onClick={() => { setShowSaveInput((v) => !v); setSaveName('') }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Save new
            </button>
          )}
        </div>

        {showSaveInput && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50 bg-white/5">
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNew()
                if (e.key === 'Escape') { setShowSaveInput(false); setSaveName('') }
              }}
              placeholder="Preset name…"
              className="flex-1 min-w-0 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
            />
            <button
              type="button"
              disabled={!saveName.trim() || saving}
              onClick={handleSaveNew}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 hover:bg-primary/30 text-primary disabled:opacity-40 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setShowSaveInput(false); setSaveName('') }}
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10 text-muted-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {showTabs && (
          <div className="flex border-b border-border/50">
            {tabs.includes('community') && (
              <TabButton active={tab === 'community'} onClick={() => setTab('community')}>
                <Users className="h-3 w-3" />
                Community
              </TabButton>
            )}
            {tabs.includes('mine') && (
              <TabButton
                active={tab === 'mine'}
                onClick={() => { if (isAuthenticated) setTab('mine') }}
                disabled={!isAuthenticated}
              >
                <BookMarked className="h-3 w-3" />
                My presets
              </TabButton>
            )}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          ) : presets.length === 0 ? (
            <EmptyState tab={tab} isAuthenticated={isAuthenticated} />
          ) : (
            <ul className="divide-y divide-border/30">
              {presets.map((preset) => (
                <PresetRow
                  key={preset.id}
                  preset={preset}
                  isMine={tab === 'mine'}
                  showCommunityToggle={!!onToggleCommunity}
                  renamingId={renamingId}
                  renameValue={renameValue}
                  deletingId={deletingId}
                  overwrittenId={overwrittenId}
                  onApply={() => { onApply(preset.data); setOpen(false) }}
                  onOverwrite={() => handleOverwrite(preset.id)}
                  onToggleCommunity={() => handleToggleCommunity(preset.id, preset.is_community)}
                  onStartRename={() => { setRenamingId(preset.id); setRenameValue(preset.name) }}
                  onRenameChange={setRenameValue}
                  onRenameConfirm={() => handleRename(preset.id)}
                  onRenameCancel={() => setRenamingId(null)}
                  onDeleteRequest={() => setDeletingId(preset.id)}
                  onDeleteConfirm={() => handleDelete(preset.id)}
                  onDeleteCancel={() => setDeletingId(null)}
                />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TabButton({
  active, onClick, disabled, children,
}: {
  active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors',
        active ? 'text-foreground border-b-2 border-primary -mb-px' : 'text-muted-foreground hover:text-foreground',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {children}
    </button>
  )
}

function EmptyState({ tab, isAuthenticated }: { tab: PresetsTab; isAuthenticated: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center px-4">
      <BookMarked className="h-6 w-6 text-muted-foreground/40" />
      <p className="text-xs text-muted-foreground">
        {tab === 'community'
          ? 'No community presets yet.'
          : isAuthenticated
            ? 'No presets saved yet. Use "Save new" to save the current configuration.'
            : 'Sign in to save and view your presets.'}
      </p>
    </div>
  )
}

interface PresetRowProps {
  preset: PresetData
  isMine: boolean
  showCommunityToggle: boolean
  renamingId: string | null
  renameValue: string
  deletingId: string | null
  overwrittenId: string | null
  onApply: () => void
  onOverwrite: () => void
  onToggleCommunity: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onRenameConfirm: () => void
  onRenameCancel: () => void
  onDeleteRequest: () => void
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
}

function PresetRow({
  preset, isMine, showCommunityToggle, renamingId, renameValue, deletingId, overwrittenId,
  onApply, onOverwrite, onToggleCommunity, onStartRename, onRenameChange, onRenameConfirm,
  onRenameCancel, onDeleteRequest, onDeleteConfirm, onDeleteCancel,
}: PresetRowProps) {
  const isRenaming = renamingId === preset.id
  const isDeleting = deletingId === preset.id
  const justOverwritten = overwrittenId === preset.id

  if (isDeleting) {
    return (
      <li className="flex items-center justify-between gap-2 px-3 py-2.5 bg-red-500/10">
        <span className="text-xs text-foreground/80 truncate">Delete "{preset.name}"?</span>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={onDeleteConfirm} className="rounded-md px-2 py-0.5 text-[11px] font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">Delete</button>
          <button type="button" onClick={onDeleteCancel} className="rounded-md px-2 py-0.5 text-[11px] font-medium hover:bg-white/10 text-muted-foreground transition-colors">Cancel</button>
        </div>
      </li>
    )
  }

  if (isRenaming) {
    return (
      <li className="flex items-center gap-1.5 px-3 py-2">
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onRenameConfirm(); if (e.key === 'Escape') onRenameCancel() }}
          className="flex-1 min-w-0 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
        />
        <button type="button" onClick={onRenameConfirm} className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 hover:bg-primary/30 text-primary transition-colors"><Check className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={onRenameCancel} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10 text-muted-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>
      </li>
    )
  }

  return (
    <li className="group flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors">
      <div className="h-12 w-12 shrink-0 rounded-md border border-border/40 bg-white/5 overflow-hidden">
        {preset.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preset.thumbnail_url} alt={preset.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <div className="h-3 w-5 rounded-sm border border-muted-foreground/30" />
          </div>
        )}
      </div>
      <button type="button" onClick={onApply} className="flex-1 min-w-0 text-left">
        <span className="flex items-center gap-1.5">
          <span className="block truncate text-xs font-medium text-foreground group-hover:text-foreground/90">{preset.name}</span>
          {isMine && preset.is_community && <Globe className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />}
        </span>
        <span className="block text-[10px] text-muted-foreground/60">{new Date(preset.created_at).toLocaleDateString()}</span>
      </button>
      {isMine && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors opacity-0 group-hover:opacity-100',
                justOverwritten ? 'text-green-400 bg-green-500/10 opacity-100' : 'text-muted-foreground hover:text-foreground hover:bg-white/10',
              )}
            >
              {justOverwritten ? <Check className="h-3 w-3" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="left" align="start" className="min-w-44">
            <DropdownMenuItem onClick={onOverwrite}><Save className="h-3.5 w-3.5" />Update with current</DropdownMenuItem>
            {showCommunityToggle && (
              <DropdownMenuItem onClick={onToggleCommunity}>
                {preset.is_community ? <><GlobeLock className="h-3.5 w-3.5" />Remove from community</> : <><Globe className="h-3.5 w-3.5" />Share with community</>}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onStartRename}><Pencil className="h-3.5 w-3.5" />Rename</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDeleteRequest}><Trash2 className="h-3.5 w-3.5" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
