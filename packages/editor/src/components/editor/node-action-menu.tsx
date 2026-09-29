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
import { cn } from '../../lib/utils'
import { shortcutDisplayValue } from '../ui/primitives/shortcut-token'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/primitives/tooltip'
import { RegistryActionContributions } from './registry-action-contributions'

const BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
const DESTRUCTIVE = 'hover:bg-destructive/10 hover:text-destructive'
const DISABLED = 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground'

/**
 * One button of an action pill, with the editor's tooltip: its name, and the
 * keys that do the same where there are any. A disabled button still shows
 * its tooltip (it stays hoverable) so it can say why it is off.
 */
export function ActionMenuButton({
  label,
  keys,
  onClick,
  destructive = false,
  disabled = false,
  disabledReason,
  children,
}: {
  label: string
  /** Keys pressed together, as `ShortcutToken` names them (`Cmd/Ctrl`, `G`). */
  keys?: string[]
  onClick?: MouseEventHandler<HTMLButtonElement>
  destructive?: boolean
  disabled?: boolean
  /** The tooltip while disabled; the label otherwise. */
  disabledReason?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-disabled={disabled || undefined}
          aria-label={label}
          className={cn(BUTTON, destructive && DESTRUCTIVE, disabled && DISABLED)}
          data-action-disabled={disabled || undefined}
          onClick={(event) => {
            if (disabled) {
              event.stopPropagation()
              return
            }
            onClick?.(event)
          }}
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2" side="top" sideOffset={6}>
        <span>{disabled && disabledReason ? disabledReason : label}</span>
        {!disabled && keys?.length ? (
          <span className="flex items-center gap-0.5">
            {keys.map((key) => (
              <kbd
                className="rounded border border-background/30 px-1 font-mono text-[10px] leading-4 opacity-80"
                key={key}
              >
                {shortcutDisplayValue(key)}
              </kbd>
            ))}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

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
