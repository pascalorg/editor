'use client'

import useDrawingView, {
  EDITOR_DRAWING_TYPE_OPTIONS,
} from '../../../store/use-drawing-view'
import { cn } from '../../utils'

/**
 * Floor plan ⇄ Site plan switch for the 2D editor.
 *
 * Sits with the other floating plan controls in the floor-plan viewport
 * (bottom-left, beside the compass). Theme tokens only.
 */
export function FloorplanDrawingTypeSwitch({ className }: { className?: string }) {
  const drawingType = useDrawingView((s) => s.drawingType)
  const setDrawingType = useDrawingView((s) => s.setDrawingType)

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-3 left-14 z-30 flex items-center gap-0.5 rounded-full border border-border bg-card/90 p-0.5 shadow-sm backdrop-blur-md',
        className,
      )}
    >
      {EDITOR_DRAWING_TYPE_OPTIONS.map((option) => (
        <button
          aria-pressed={drawingType === option.id}
          className={cn(
            'rounded-full px-2.5 py-1 font-medium text-xs transition',
            drawingType === option.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          key={option.id}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setDrawingType(option.id)
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
