'use client'

import { emitter } from '@pascal-app/core'
import {
  BookMarked,
  Check,
  Globe,
  GlobeLock,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { PresetsTab } from '../../../../contexts/presets-context'
import { cn } from '../../../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../primitives/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'

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
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 overflow-hidden rounded-xl border-border/50 bg-sidebar/95 p-0 shadow-2xl backdrop-blur-xl"
        side="left"
        sideOffset={8}
      >
        <div className="flex items-center justify-between border-border/50 border-b px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <BookMarked className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground text-xs tracking-tight">
              {type === 'door' ? 'Door' : 'Window'} Presets
            </span>
          </div>
          {isAuthenticated && (
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[11px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              onClick={() => {
                setShowSaveInput((v) => !v)
                setSaveName('')
              }}
              type="button"
            >
              <Plus className="h-3 w-3" />
              Save new
            </button>
          )}
        </div>

        {showSaveInput && (
          <div className="flex items-center gap-1.5 border-border/50 border-b bg-white/5 px-3 py-2">
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-foreground text-xs outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-1 focus:ring-ring/30"
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNew()
                if (e.key === 'Escape') {
                  setShowSaveInput(false)
                  setSaveName('')
                }
              }}
              placeholder="Preset name…"
              value={saveName}
            />
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 text-primary transition-colors hover:bg-primary/30 disabled:opacity-40"
              disabled={!saveName.trim() || saving}
              onClick={handleSaveNew}
              type="button"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10"
              onClick={() => {
                setShowSaveInput(false)
                setSaveName('')
              }}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {showTabs && (
          <div className="flex border-border/50 border-b">
            {tabs.includes('community') && (
              <TabButton active={tab === 'community'} onClick={() => setTab('community')}>
                <Users className="h-3 w-3" />
                Community
              </TabButton>
            )}
            {tabs.includes('mine') && (
              <TabButton
                active={tab === 'mine'}
                disabled={!isAuthenticated}
                onClick={() => {
                  if (isAuthenticated) setTab('mine')
                }}
              >
                <BookMarked className="h-3 w-3" />
                My presets
              </TabButton>
            )}
          </div>
        )}

        <div className="no-scrollbar max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          ) : presets.length === 0 ? (
            <EmptyState isAuthenticated={isAuthenticated} tab={tab} />
          ) : (
            <ul className="divide-y divide-border/30">
              {presets.map((preset) => (
                <PresetRow
                  deletingId={deletingId}
                  isMine={tab === 'mine'}
                  key={preset.id}
                  onApply={() => {
                    onApply(preset.data)
                    setOpen(false)
                  }}
                  onDeleteCancel={() => setDeletingId(null)}
                  onDeleteConfirm={() => handleDelete(preset.id)}
                  onDeleteRequest={() => setDeletingId(preset.id)}
                  onOverwrite={() => handleOverwrite(preset.id)}
                  onRenameCancel={() => setRenamingId(null)}
                  onRenameChange={setRenameValue}
                  onRenameConfirm={() => handleRename(preset.id)}
                  onStartRename={() => {
                    setRenamingId(preset.id)
                    setRenameValue(preset.name)
                  }}
                  onToggleCommunity={() => handleToggleCommunity(preset.id, preset.is_community)}
                  overwrittenId={overwrittenId}
                  preset={preset}
                  renameValue={renameValue}
                  renamingId={renamingId}
                  showCommunityToggle={!!onToggleCommunity}
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
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 py-2 font-medium text-[11px] transition-colors',
        active
          ? '-mb-px border-primary border-b-2 text-foreground'
          : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-40',
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function EmptyState({ tab, isAuthenticated }: { tab: PresetsTab; isAuthenticated: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <BookMarked className="h-6 w-6 text-muted-foreground/40" />
      <p className="text-muted-foreground text-xs">
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
  preset,
  isMine,
  showCommunityToggle,
  renamingId,
  renameValue,
  deletingId,
  overwrittenId,
  onApply,
  onOverwrite,
  onToggleCommunity,
  onStartRename,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: PresetRowProps) {
  const isRenaming = renamingId === preset.id
  const isDeleting = deletingId === preset.id
  const justOverwritten = overwrittenId === preset.id

  if (isDeleting) {
    return (
      <li className="flex items-center justify-between gap-2 bg-red-500/10 px-3 py-2.5">
        <span className="truncate text-foreground/80 text-xs">Delete "{preset.name}"?</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="rounded-md bg-red-500/20 px-2 py-0.5 font-medium text-[11px] text-red-400 transition-colors hover:bg-red-500/30"
            onClick={onDeleteConfirm}
            type="button"
          >
            Delete
          </button>
          <button
            className="rounded-md px-2 py-0.5 font-medium text-[11px] text-muted-foreground transition-colors hover:bg-white/10"
            onClick={onDeleteCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </li>
    )
  }

  if (isRenaming) {
    return (
      <li className="flex items-center gap-1.5 px-3 py-2">
        <input
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-foreground text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameConfirm()
            if (e.key === 'Escape') onRenameCancel()
          }}
          value={renameValue}
        />
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 text-primary transition-colors hover:bg-primary/30"
          onClick={onRenameConfirm}
          type="button"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10"
          onClick={onRenameCancel}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </li>
    )
  }

  return (
    <li className="group flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/5">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border/40 bg-white/5">
        {preset.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={preset.name}
            className="h-full w-full object-cover"
            src={preset.thumbnail_url}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-3 w-5 rounded-sm border border-muted-foreground/30" />
          </div>
        )}
      </div>
      <button className="min-w-0 flex-1 text-left" onClick={onApply} type="button">
        <span className="flex items-center gap-1.5">
          <span className="block truncate font-medium text-foreground text-xs group-hover:text-foreground/90">
            {preset.name}
          </span>
          {isMine && preset.is_community && (
            <Globe className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
          )}
        </span>
        <span className="block text-[10px] text-muted-foreground/60">
          {new Date(preset.created_at).toLocaleDateString()}
        </span>
      </button>
      {isMine && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-colors group-hover:opacity-100',
                justOverwritten
                  ? 'bg-green-500/10 text-green-400 opacity-100'
                  : 'text-muted-foreground hover:bg-white/10 hover:text-foreground',
              )}
              type="button"
            >
              {justOverwritten ? (
                <Check className="h-3 w-3" />
              ) : (
                <MoreHorizontal className="h-3.5 w-3.5" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44" side="left">
            <DropdownMenuItem onClick={onOverwrite}>
              <Save className="h-3.5 w-3.5" />
              Update with current
            </DropdownMenuItem>
            {showCommunityToggle && (
              <DropdownMenuItem onClick={onToggleCommunity}>
                {preset.is_community ? (
                  <>
                    <GlobeLock className="h-3.5 w-3.5" />
                    Remove from community
                  </>
                ) : (
                  <>
                    <Globe className="h-3.5 w-3.5" />
                    Share with community
                  </>
                )}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onStartRename}>
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDeleteRequest} variant="destructive">
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
