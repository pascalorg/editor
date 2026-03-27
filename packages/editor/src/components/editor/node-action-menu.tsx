'use client'

import { Copy, Move, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { MouseEventHandler, PointerEventHandler } from 'react'

type NodeActionMenuProps = {
  onDelete: MouseEventHandler<HTMLButtonElement>
  onDuplicate: MouseEventHandler<HTMLButtonElement>
  onMove: MouseEventHandler<HTMLButtonElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
}

export function NodeActionMenu({
  onDelete,
  onDuplicate,
  onMove,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: NodeActionMenuProps) {
  const t = useTranslations('nodeActions')

  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-xl backdrop-blur-md"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
      <button
        aria-label={t('move')}
        className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={onMove}
        title={t('move')}
        type="button"
      >
        <Move className="h-4 w-4" />
      </button>
      <button
        aria-label={t('duplicate')}
        className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={onDuplicate}
        title={t('duplicate')}
        type="button"
      >
        <Copy className="h-4 w-4" />
      </button>
      <button
        aria-label={t('delete')}
        className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        onClick={onDelete}
        title={t('delete')}
        type="button"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
