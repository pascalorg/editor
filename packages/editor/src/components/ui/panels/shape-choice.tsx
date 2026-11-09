'use client'

import { usePascalI18n } from '@pascal-app/core'
import { Pentagon, Square } from 'lucide-react'
import { cn } from '../../../lib/utils'

export type OutlineShape = 'rectangle' | 'polygon'

const SHAPES = [
  { id: 'rectangle', label: /* i18n */ { id: 'editor.panels.shapeChoice.rectangle', message: 'Rectangle' }, Icon: Square },
  { id: 'polygon', label: /* i18n */ { id: 'editor.panels.shapeChoice.polygon', message: 'Polygon' }, Icon: Pentagon },
] as const

const pill =
  'inline-flex items-center gap-1 rounded-full border border-border/50 px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50'

/**
 * The outline shape, picked before drawing starts — the same two choices the
 * Build panel's room tiles offer, so a cut or a mezzanine is started the way a
 * room is.
 */
export function ShapeChoice({
  label,
  onPick,
  disabled,
  className,
  data,
}: {
  label: string
  onPick: (shape: OutlineShape) => void
  disabled?: boolean
  className?: string
  /** `data-shape-choice` hook for tests and proofs. */
  data?: string
}) {
  const i18n = usePascalI18n()
  return (
    <div
      className={cn('flex min-h-7 flex-wrap items-center justify-between gap-2', className)}
      data-shape-choice={data}
    >
      <span className="whitespace-nowrap">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {SHAPES.map(({ id, label: shapeLabel, Icon }) => (
          <button
            className={pill}
            data-shape={id}
            disabled={disabled}
            key={id}
            onClick={() => onPick(id)}
            type="button"
          >
            <Icon aria-hidden className="h-3 w-3" />
            {i18n._(shapeLabel)}
          </button>
        ))}
      </div>
    </div>
  )
}
