'use client'

import { FloorplanGeometryRenderer } from '@pascal-app/editor'
import { useMemo } from 'react'
import type { DrawingResult } from './geometry/types'

/**
 * Renders a section / elevation drawing through the editor's own floor-plan
 * SVG renderer, fitted to a box. This is the component the sheets workstream
 * (WS2) embeds in a `section` / `elevation` viewport — pass it whatever
 * `buildSectionDrawing` / `buildElevationDrawing` returned.
 *
 * The drawing's coordinates are already in the renderer's y-down space (y =
 * negated world elevation, see `geometry/types.ts`), so the viewBox is the
 * drawing's own bounds with no extra transform.
 */
export function SectionPreview({
  drawing,
  className,
  padding = 0,
  background = 'transparent',
}: {
  drawing: DrawingResult
  className?: string
  /** Extra margin in drawing metres, on top of the bounds' own padding. */
  padding?: number
  background?: string
}) {
  const viewBox = useMemo(() => {
    const { minX, minY, maxX, maxY } = drawing.bounds
    const width = Math.max(1e-3, maxX - minX + padding * 2)
    const height = Math.max(1e-3, maxY - minY + padding * 2)
    return `${minX - padding} ${minY - padding} ${width} ${height}`
  }, [drawing.bounds, padding])

  if (drawing.primitives.length === 0) {
    return (
      <div
        className={
          className ??
          'flex h-full w-full items-center justify-center text-muted-foreground text-xs'
        }
      >
        Nothing to draw
      </div>
    )
  }

  return (
    <svg
      className={className}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      style={{ background, width: '100%', height: '100%' }}
      role="img"
      aria-label="Vector drawing"
    >
      <title>Section preview</title>
      {drawing.primitives.map((geometry, index) => (
        <FloorplanGeometryRenderer
          // Drawing primitives are positional and rebuilt wholesale on every
          // scene change, so the index IS the identity here.
          key={index}
          geometry={geometry}
          renderMode="screen"
          pointerEventsOverride="none"
        />
      ))}
    </svg>
  )
}
