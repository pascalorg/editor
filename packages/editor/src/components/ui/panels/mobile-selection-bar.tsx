'use client'

import type { AnyNode } from '@pascal-app/core'
import { Copy, Move, SlidersHorizontal, Trash2 } from 'lucide-react'
import Image from 'next/image'
import type { MouseEventHandler } from 'react'
import { cn } from '../../../lib/utils'
import { getNodeDisplay } from './node-display'

interface MobileSelectionBarProps {
  node: AnyNode
  onMove: () => void
  onDuplicate: () => void
  onDelete: () => void
  onEdit: () => void
}

const ACTION_BTN =
  'flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground'

export function MobileSelectionBar({
  node,
  onMove,
  onDuplicate,
  onDelete,
  onEdit,
}: MobileSelectionBarProps) {
  const { icon, label } = getNodeDisplay(node)

  const stop: MouseEventHandler<HTMLButtonElement> = (e) => e.stopPropagation()

  return (
    <div className="pointer-events-auto absolute right-3 bottom-6 left-3 z-50 flex h-12 items-stretch gap-1 rounded-2xl border border-border/50 bg-background/95 px-2 shadow-2xl backdrop-blur-xl">
      <button
        aria-label={`Edit ${label}`}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-white/8',
        )}
        onClick={onEdit}
        type="button"
      >
        <Image
          alt=""
          className="shrink-0 rounded object-contain"
          height={20}
          src={icon}
          width={20}
        />
        <span className="truncate font-medium text-foreground text-sm">{label}</span>
      </button>

      <div className="flex items-center gap-0.5 border-border/40 border-l pl-1">
        <button
          aria-label="Move"
          className={ACTION_BTN}
          onClick={(e) => {
            stop(e)
            onMove()
          }}
          type="button"
        >
          <Move className="h-4 w-4" />
        </button>
        <button
          aria-label="Duplicate"
          className={ACTION_BTN}
          onClick={(e) => {
            stop(e)
            onDuplicate()
          }}
          type="button"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          aria-label="Delete"
          className={cn(ACTION_BTN, 'hover:bg-red-500/15 hover:text-red-400')}
          onClick={(e) => {
            stop(e)
            onDelete()
          }}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          aria-label="Edit properties"
          className={ACTION_BTN}
          onClick={(e) => {
            stop(e)
            onEdit()
          }}
          type="button"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
