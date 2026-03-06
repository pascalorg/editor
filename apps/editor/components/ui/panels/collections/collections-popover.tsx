'use client'

import type { AnyNodeId, Collection, CollectionId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { Check, ChevronDown, ChevronRight, Layers, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/primitives/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives/popover'
import { ColorDot } from '@/components/ui/primitives/color-dot'
import { cn } from '@/lib/utils'

interface CollectionsPopoverProps {
  nodeId: AnyNodeId
  collectionIds?: CollectionId[]
  children: React.ReactNode
}

export function CollectionsPopover({ nodeId, collectionIds, children }: CollectionsPopoverProps) {
  const collections = useScene((s) => s.collections)
  const nodes = useScene((s) => s.nodes)
  const createCollection = useScene((s) => s.createCollection)
  const deleteCollection = useScene((s) => s.deleteCollection)
  const updateCollection = useScene((s) => s.updateCollection)
  const addToCollection = useScene((s) => s.addToCollection)
  const removeFromCollection = useScene((s) => s.removeFromCollection)

  const [open, setOpen] = useState(false)
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [createName, setCreateName] = useState('')

  const [renamingId, setRenamingId] = useState<CollectionId | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameColor, setRenameColor] = useState('')

  const [deletingId, setDeletingId] = useState<CollectionId | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<CollectionId>>(new Set())

  const memberIds = collectionIds ?? []
  const allCollections = Object.values(collections)

  const handleCreate = () => {
    if (!createName.trim()) return
    createCollection(createName.trim(), [nodeId])
    setCreateName('')
    setShowCreateInput(false)
  }

  const handleRenameConfirm = (id: CollectionId) => {
    if (!renameValue.trim()) return
    updateCollection(id, { name: renameValue.trim(), color: renameColor || undefined })
    setRenamingId(null)
  }

  const toggleMembership = (collectionId: CollectionId) => {
    if (memberIds.includes(collectionId)) {
      removeFromCollection(collectionId, nodeId)
    } else {
      addToCollection(collectionId, nodeId)
    }
  }

  const toggleExpand = (collectionId: CollectionId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(collectionId)) next.delete(collectionId)
      else next.add(collectionId)
      return next
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-72 p-0 border-border/50 bg-sidebar/95 backdrop-blur-xl shadow-2xl rounded-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground tracking-tight">Collections</span>
          </div>
          <button
            type="button"
            onClick={() => { setShowCreateInput((v) => !v); setCreateName('') }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        {/* Create input */}
        {showCreateInput && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50 bg-white/5">
            <input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { setShowCreateInput(false); setCreateName('') }
              }}
              placeholder="Collection name…"
              className="flex-1 min-w-0 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
            />
            <button
              type="button"
              disabled={!createName.trim()}
              onClick={handleCreate}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 hover:bg-primary/30 text-primary disabled:opacity-40 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setShowCreateInput(false); setCreateName('') }}
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10 text-muted-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Collections list */}
        <div className="max-h-72 overflow-y-auto no-scrollbar">
          {allCollections.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center px-4">
              <Layers className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                No collections yet. Create one to group items together.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/30">
              {allCollections.map((collection) => {
                const isIn = memberIds.includes(collection.id)
                const isExpanded = expandedIds.has(collection.id)
                const isRenaming = renamingId === collection.id
                const isDeleting = deletingId === collection.id

                if (isDeleting) {
                  return (
                    <li key={collection.id} className="flex items-center justify-between gap-2 px-3 py-2.5 bg-red-500/10">
                      <span className="text-xs text-foreground/80 truncate">Delete "{collection.name}"?</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => { deleteCollection(collection.id); setDeletingId(null) }}
                          className="rounded-md px-2 py-0.5 text-[11px] font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          className="rounded-md px-2 py-0.5 text-[11px] font-medium hover:bg-white/10 text-muted-foreground transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </li>
                  )
                }

                if (isRenaming) {
                  return (
                    <li key={collection.id} className="flex items-center gap-1.5 px-3 py-2">
                      <ColorDot color={renameColor || '#6366f1'} onChange={setRenameColor} />
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameConfirm(collection.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="flex-1 min-w-0 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
                      />
                      <button
                        type="button"
                        onClick={() => handleRenameConfirm(collection.id)}
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10 text-muted-foreground transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  )
                }

                return (
                  <li key={collection.id}>
                    <div className="group flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors">
                      {/* Color dot — click to pick color */}
                      <ColorDot
                        color={collection.color ?? '#6366f1'}
                        onChange={(c) => updateCollection(collection.id, { color: c })}
                      />

                      {/* Name + count — clicking toggles membership */}
                      <button
                        type="button"
                        onClick={() => toggleMembership(collection.id)}
                        className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                      >
                        <span className={cn('truncate text-xs font-medium', isIn ? 'text-foreground' : 'text-muted-foreground')}>
                          {collection.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">
                          {collection.nodeIds.length}
                        </span>
                      </button>

                      {/* Membership check */}
                      <div
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors pointer-events-none',
                          isIn ? 'border-primary bg-primary/20 text-primary' : 'border-border/50',
                        )}
                      >
                        {isIn && <Check className="h-2.5 w-2.5" />}
                      </div>

                      {/* Expand toggle (only if has members) */}
                      {collection.nodeIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(collection.id)}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3 w-3" />
                            : <ChevronRight className="h-3 w-3" />}
                        </button>
                      )}

                      {/* More dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="left" align="start" className="min-w-40">
                          <DropdownMenuItem onClick={() => { setRenamingId(collection.id); setRenameValue(collection.name); setRenameColor(collection.color ?? '') }}>
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeletingId(collection.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Expanded member list */}
                    {isExpanded && (
                      <ul className="pb-1 pl-6 pr-3 flex flex-col gap-0.5">
                        {collection.nodeIds.map((nid) => {
                          const n = nodes[nid]
                          return (
                            <li key={nid} className="flex items-center gap-1.5 py-0.5">
                              <span className="h-1 w-1 rounded-full bg-muted-foreground/40 shrink-0" />
                              <span className={cn('truncate text-[11px]', nid === nodeId ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                                {n?.name ?? nid}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
