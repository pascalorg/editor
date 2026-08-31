'use client'

import { Icon } from '@iconify/react'
import { Copy, Group, Move, PencilRuler, Search, Spline, Trash2, Ungroup } from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler } from 'react'
import { messages, useLocale } from '../../lib/i18n'

type NodeActionMenuProps = {
  onFind?: MouseEventHandler<HTMLButtonElement>
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onEditMesh?: MouseEventHandler<HTMLButtonElement>
  onCurve?: MouseEventHandler<HTMLButtonElement>
  /** Session group (Ctrl/Cmd+G) — multi-selection floating pill. */
  onGroup?: MouseEventHandler<HTMLButtonElement>
  /** Dissolve session group (Ctrl/Cmd+Shift+G). */
  onUngroup?: MouseEventHandler<HTMLButtonElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
}

export function NodeActionMenu({
  onFind,
  onAddHole,
  onDelete,
  onDuplicate,
  onMove,
  onEditMesh,
  onCurve,
  onGroup,
  onUngroup,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: NodeActionMenuProps) {
  const { locale } = useLocale()
  const t = (key: string) => (messages[locale] as Record<string, string>)[key] || key

  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-xl backdrop-blur-md"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
      {onFind && (
        <button
          aria-label="Find in catalog"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onFind}
          title="Find in catalog"
          type="button"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
      {onMove && (
        <button
          aria-label={t('nodeActions.move')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onMove}
          title={t('nodeActions.move')}
          type="button"
        >
          <Move className="h-4 w-4" />
        </button>
      )}
      {onEditMesh && (
        <button
          aria-label="Edit mesh"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onEditMesh}
          title="Edit mesh"
          type="button"
        >
          <PencilRuler className="h-4 w-4" />
        </button>
      )}
      {onGroup && (
        <button
          aria-label="Group selection"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onGroup}
          title="Group (Ctrl/Cmd+G)"
          type="button"
        >
          <Group className="h-4 w-4" />
        </button>
      )}
      {onUngroup && (
        <button
          aria-label="Ungroup selection"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onUngroup}
          title="Ungroup (Ctrl/Cmd+Shift+G)"
          type="button"
        >
          <Ungroup className="h-4 w-4" />
        </button>
      )}
      {onCurve && (
        <button
          aria-label={t('nodeActions.curve')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onCurve}
          title={t('nodeActions.curve')}
          type="button"
        >
          <Spline className="h-4 w-4" />
        </button>
      )}
      {onDuplicate && (
        <button
          aria-label={t('nodeActions.duplicate')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onDuplicate}
          title={t('nodeActions.duplicate')}
          type="button"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
      {onAddHole && (
        <button
          aria-label={t('nodeActions.cutOut')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onAddHole}
          title={t('nodeActions.cutOut')}
          type="button"
        >
          <Icon height={16} icon="carbon:cut-out" width={16} />
        </button>
      )}
      {onDelete && (
        <button
          aria-label={t('nodeActions.delete')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          title={t('nodeActions.delete')}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
