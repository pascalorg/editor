'use client'

import { useScene } from '@pascal-app/core'
import { Eye, EyeOff, Layers, Lock, LockOpen } from 'lucide-react'
import { cn } from '../../../../lib/utils'

/**
 * Collection visibility and lock, reachable without a selection.
 *
 * `CollectionsPopover` hangs off a selected node, which cannot manage a hidden
 * collection: hiding it takes its members out of the view, so there is nothing
 * left to select to open the popover from. Anything that can hide a collection
 * has to live somewhere a hidden collection is still reachable.
 *
 * Renders nothing when there are no collections, so it stays out of the way
 * until the scene actually uses them.
 */
export function CollectionsSection() {
  const collections = useScene((s) => s.collections)
  const updateCollection = useScene((s) => s.updateCollection)
  const list = Object.values(collections)

  if (list.length === 0) return null

  return (
    <div className="flex flex-col border-border/40 border-b">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-semibold text-muted-foreground text-xs tracking-tight">
          Collections
        </span>
      </div>
      <ul className="flex flex-col pb-2">
        {list.map((collection) => {
          const isHidden = collection.visible === false
          const isLocked = collection.locked === true
          return (
            <li
              className="flex items-center gap-2 px-3 py-1 transition-colors hover:bg-white/5"
              key={collection.id}
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: collection.color ?? '#6366f1' }}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-xs',
                  isHidden ? 'text-muted-foreground/60' : 'text-foreground',
                )}
              >
                {collection.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {collection.nodeIds.length}
              </span>
              <button
                aria-label={isHidden ? 'Show collection' : 'Hide collection'}
                className={cn(
                  'shrink-0 rounded p-0.5 transition-colors hover:bg-white/10',
                  isHidden ? 'text-foreground' : 'text-muted-foreground/50',
                )}
                onClick={() => updateCollection(collection.id, { visible: isHidden })}
                title={isHidden ? 'Show collection' : 'Hide collection'}
                type="button"
              >
                {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                aria-label={isLocked ? 'Unlock collection' : 'Lock collection'}
                className={cn(
                  'shrink-0 rounded p-0.5 transition-colors hover:bg-white/10',
                  isLocked ? 'text-foreground' : 'text-muted-foreground/50',
                )}
                onClick={() => updateCollection(collection.id, { locked: !isLocked })}
                title={isLocked ? 'Unlock collection' : 'Lock collection'}
                type="button"
              >
                {isLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
