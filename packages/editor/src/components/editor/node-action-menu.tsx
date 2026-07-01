'use client'

import { Icon } from '@iconify/react'
import { Copy, Move, Spline, Trash2 } from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler } from 'react'
import { t } from '../../i18n'

type NodeActionMenuProps = {
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onCurve?: MouseEventHandler<HTMLButtonElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
}

export function NodeActionMenu({
  onAddHole,
  onDelete,
  onDuplicate,
  onMove,
  onCurve,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: NodeActionMenuProps) {
  const moveLabel = t('actionMenu.move', 'Move')
  const curveLabel = t('actionMenu.curve', 'Curve')
  const duplicateLabel = t('actionMenu.duplicate', 'Duplicate')
  const cutOutLabel = t('actionMenu.cutOut', 'Cut Out')
  const deleteLabel = t('actionMenu.delete', 'Delete')

  return (
    <div
      className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-border bg-background/95 p-0.5 shadow-lg backdrop-blur-md"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
      {onMove && (
        <button
          aria-label={moveLabel}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onMove}
          title={moveLabel}
          type="button"
        >
          <Move className="h-3 w-3" />
        </button>
      )}
      {onCurve && (
        <button
          aria-label={curveLabel}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onCurve}
          title={curveLabel}
          type="button"
        >
          <Spline className="h-3 w-3" />
        </button>
      )}
      {onDuplicate && (
        <button
          aria-label={duplicateLabel}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onDuplicate}
          title={duplicateLabel}
          type="button"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
      {onAddHole && (
        <button
          aria-label={cutOutLabel}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onAddHole}
          title={cutOutLabel}
          type="button"
        >
          <Icon height={12} icon="carbon:cut-out" width={12} />
        </button>
      )}
      {onDelete && (
        <button
          aria-label={deleteLabel}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          title={deleteLabel}
          type="button"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
