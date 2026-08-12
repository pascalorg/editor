'use client'

import { AXIS_LABELS } from '../../lib/axis-lock'
import { cn } from '../../lib/utils'
import useAxisLock from '../../store/use-axis-lock'
import { useFloorplanDraftPreview } from '../../store/use-floorplan-draft-preview'
import useMeasurementInput from '../../store/use-measurement-input'
import useWallSnapIndicator, { wallSnapLabel } from '../../store/use-wall-snap-indicator'

/**
 * The measurements box readout.
 *
 * It cannot live in `DimensionPill`: during drafting the wall tool draws its own
 * in-scene length label and the pill is not mounted at all — only the floating
 * action menu of a *selected* node renders one. So a readout put there is
 * invisible for exactly the gesture it exists to serve.
 *
 * Mounted once at the editor root instead, so every tool that can consume a
 * typed dimension gets the same affordance with no per-tool wiring. It shows
 * only while something is actually being typed or constrained — the length
 * itself already reads from each tool's own live label.
 */
export function TypedDimensionHud() {
  const typed = useMeasurementInput((state) => state.buffer)
  const axis = useAxisLock((state) => state.axis)
  const snap = useWallSnapIndicator((state) => state.point)
  const wallDraftStart = useFloorplanDraftPreview((state) => state.wallDraftStart)
  const polygonPoints = useFloorplanDraftPreview((state) => state.polygonDraftPoints.length)

  const drafting = wallDraftStart !== null || polygonPoints > 0
  // An explicit axis lock replaces the snap name — the lock is what is holding
  // the point, so naming a snap underneath it would be misleading.
  const constraint = axis ? AXIS_LABELS[axis] : drafting && snap ? wallSnapLabel(snap) : null

  if (!typed && !constraint) return null

  return (
    <div className="-translate-x-1/2 pointer-events-none fixed bottom-24 left-1/2 z-50">
      <div
        className={cn(
          'flex items-center gap-2 whitespace-nowrap rounded-full border bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur',
          typed || axis ? 'border-primary/70' : 'border-border/60',
        )}
      >
        {constraint ? (
          <span className={axis ? 'font-medium text-primary' : 'font-medium text-foreground'}>
            {constraint}
          </span>
        ) : null}
        {constraint && typed ? (
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
        ) : null}
        {typed ? (
          <span className="font-medium text-foreground">
            {typed}
            <span aria-hidden className="ml-px animate-pulse text-primary">
              ▌
            </span>
          </span>
        ) : null}
      </div>
    </div>
  )
}
