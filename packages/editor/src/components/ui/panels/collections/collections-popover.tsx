'use client'

import type { AnyNodeId, Collection, CollectionId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { ColorDot } from '../../../../components/ui/primitives/color-dot'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../components/ui/primitives/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../components/ui/primitives/popover'
import { cn } from '../../../../lib/utils'

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
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 overflow-hidden rounded-xl border-border/50 bg-sidebar/95 p-0 shadow-2xl backdrop-blur-xl"
        side="left"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-border/50 border-b px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground text-xs tracking-tight">
              Collections
            </span>
          </div>
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[11px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            onClick={() => {
              setShowCreateInput((v) => !v)
              setCreateName('')
            }}
            type="button"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        {/* Create input */}
        {showCreateInput && (
          <div className="flex items-center gap-1.5 border-border/50 border-b bg-white/5 px-3 py-2">
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-foreground text-xs outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-1 focus:ring-ring/30"
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') {
                  setShowCreateInput(false)
                  setCreateName('')
                }
              }}
              placeholder="Collection name…"
              value={createName}
            />
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 text-primary transition-colors hover:bg-primary/30 disabled:opacity-40"
              disabled={!createName.trim()}
              onClick={handleCreate}
              type="button"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10"
              onClick={() => {
                setShowCreateInput(false)
                setCreateName('')
              }}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Collections list */}
        <div className="no-scrollbar max-h-72 overflow-y-auto">
          {allCollections.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
              <Layers className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-muted-foreground text-xs">
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
                    <li
                      className="flex items-center justify-between gap-2 bg-red-500/10 px-3 py-2.5"
                      key={collection.id}
                    >
                      <span className="truncate text-foreground/80 text-xs">
                        Delete "{collection.name}"?
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          className="rounded-md bg-red-500/20 px-2 py-0.5 font-medium text-[11px] text-red-400 transition-colors hover:bg-red-500/30"
                          onClick={() => {
                            deleteCollection(collection.id)
                            setDeletingId(null)
                          }}
                          type="button"
                        >
                          Delete
                        </button>
                        <button
                          className="rounded-md px-2 py-0.5 font-medium text-[11px] text-muted-foreground transition-colors hover:bg-white/10"
                          onClick={() => setDeletingId(null)}
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
                    <li className="flex items-center gap-1.5 px-3 py-2" key={collection.id}>
                      <ColorDot color={renameColor || '#6366f1'} onChange={setRenameColor} />
                      <input
                        autoFocus
                        className="min-w-0 flex-1 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-foreground text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameConfirm(collection.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        value={renameValue}
                      />
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 text-primary transition-colors hover:bg-primary/30"
                        onClick={() => handleRenameConfirm(collection.id)}
                        type="button"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10"
                        onClick={() => setRenamingId(null)}
                        type="button"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  )
                }

                return (
                  <li key={collection.id}>
                    <div className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-white/5">
                      {/* Color dot — click to pick color */}
                      <ColorDot
                        color={collection.color ?? '#6366f1'}
                        onChange={(c) => updateCollection(collection.id, { color: c })}
                      />

                      {/* Name + count — clicking toggles membership */}
                      <button
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        onClick={() => toggleMembership(collection.id)}
                        type="button"
                      >
                        <span
                          className={cn(
                            'truncate font-medium text-xs',
                            isIn ? 'text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {collection.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">
                          {collection.nodeIds.length}
                        </span>
                      </button>

                      {/* Membership check */}
                      <div
                        className={cn(
                          'pointer-events-none flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          isIn ? 'border-primary bg-primary/20 text-primary' : 'border-border/50',
                        )}
                      >
                        {isIn && <Check className="h-2.5 w-2.5" />}
                      </div>

                      {/* Expand toggle (only if has members) */}
                      {collection.nodeIds.length > 0 && (
                        <button
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() => toggleExpand(collection.id)}
                          type="button"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </button>
                      )}

                      {/* More dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-colors hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
                            type="button"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-40" side="left">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenamingId(collection.id)
                              setRenameValue(collection.name)
                              setRenameColor(collection.color ?? '')
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeletingId(collection.id)}
                            variant="destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Expanded member list */}
                    {isExpanded && (
                      <ul className="flex flex-col gap-0.5 pr-3 pb-1 pl-6">
                        {collection.nodeIds.map((nid) => {
                          const n = nodes[nid]
                          return (
                            <li className="flex items-center gap-1.5 py-0.5" key={nid}>
                              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                              <span
                                className={cn(
                                  'truncate text-[11px]',
                                  nid === nodeId
                                    ? 'font-medium text-foreground'
                                    : 'text-muted-foreground',
                                )}
                              >
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
