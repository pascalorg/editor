'use client'

import { Icon } from '@iconify/react'
import {
  Copy,
  Group,
  Move,
  PencilRuler,
  RotateCcw,
  RotateCw,
  Search,
  Spline,
  Trash2,
  Ungroup,
} from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler, ReactNode } from 'react'
import { ActionMenuButton } from './action-menu-button'
import { RegistryActionContributions } from './registry-action-contributions'

type NodeActionMenuProps = {
  onFind?: MouseEventHandler<HTMLButtonElement>
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onEditMesh?: MouseEventHandler<HTMLButtonElement>
  onCurve?: MouseEventHandler<HTMLButtonElement>
  /** Quarter turns (a room); sit in the Curve slot (a room has no curve). */
  onRotateLeft?: MouseEventHandler<HTMLButtonElement>
  onRotateRight?: MouseEventHandler<HTMLButtonElement>
  /** Session group (Ctrl/Cmd+G) — multi-selection floating pill. */
  onGroup?: MouseEventHandler<HTMLButtonElement>
  /** Dissolve session group (Ctrl/Cmd+Shift+G). */
  onUngroup?: MouseEventHandler<HTMLButtonElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
  /**
   * Buttons a caller contributes next to the registry contributions — for a
   * selection that is not a scene-node selection (the room), whose actions the
   * registry cannot find.
   */
  children?: ReactNode
  /** Tooltip / accessible name of the delete button. */
  deleteLabel?: string
  /** Shows the delete button greyed out, its tooltip saying why. */
  deleteDisabledReason?: string
}

export function NodeActionMenu({
  onFind,
  onAddHole,
  onDelete,
  onDuplicate,
  onMove,
  onEditMesh,
  onCurve,
  onRotateLeft,
  onRotateRight,
  onGroup,
  onUngroup,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
  children,
  deleteLabel = 'Delete',
  deleteDisabledReason,
}: NodeActionMenuProps) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-xl backdrop-blur-md"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
      {onFind && (
        <ActionMenuButton label="Find in catalog" onClick={onFind}>
          <Search className="h-4 w-4" />
        </ActionMenuButton>
      )}
      {onMove && (
        <ActionMenuButton label="Move" onClick={onMove}>
          <Move className="h-4 w-4" />
        </ActionMenuButton>
      )}
      {onEditMesh && (
        <ActionMenuButton label="Edit mesh" onClick={onEditMesh}>
          <PencilRuler className="h-4 w-4" />
        </ActionMenuButton>
      )}
      {onGroup && (
        <ActionMenuButton keys={['Cmd/Ctrl', 'G']} label="Group selection" onClick={onGroup}>
          <Group className="h-4 w-4" />
        </ActionMenuButton>
      )}
      {onUngroup && (
        <ActionMenuButton
          keys={['Cmd/Ctrl', 'Shift', 'G']}
          label="Ungroup selection"
          onClick={onUngroup}
        >
          <Ungroup className="h-4 w-4" />
        </ActionMenuButton>
      )}
      {onCurve && (
        <ActionMenuButton label="Curve" onClick={onCurve}>
          <Spline className="h-4 w-4" />
        </ActionMenuButton>
      )}
      {onRotateLeft && (
        <ActionMenuButton label="Rotate left" onClick={onRotateLeft}>
          <RotateCcw className="h-4 w-4" />
        </ActionMenuButton>
      )}
      {onRotateRight && (
        <ActionMenuButton label="Rotate right" onClick={onRotateRight}>
          <RotateCw className="h-4 w-4" />
        </ActionMenuButton>
      )}
      <RegistryActionContributions />
      {children}
      {onDuplicate && (
        <ActionMenuButton label="Duplicate" onClick={onDuplicate}>
          <Copy className="h-4 w-4" />
        </ActionMenuButton>
      )}
      {onAddHole && (
        <ActionMenuButton label="Cut out" onClick={onAddHole}>
          <Icon height={16} icon="carbon:cut-out" width={16} />
        </ActionMenuButton>
      )}
      {onDelete && (
        <ActionMenuButton
          destructive
          disabled={!!deleteDisabledReason}
          disabledReason={deleteDisabledReason}
          keys={['Delete / Backspace']}
          label={deleteLabel}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </ActionMenuButton>
      )}
    </div>
  )
}
