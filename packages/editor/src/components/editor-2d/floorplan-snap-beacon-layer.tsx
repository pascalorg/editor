'use client'

import { useWallSnapIndicator, type WallSnapKind } from '@pascal-app/editor'
import { memo } from 'react'
import { useFloorplanRender } from './floorplan-render-context'

/**
 * "Magnetic" wall-snap beacon for the 2D floor plan — the top-down twin of the
 * 3D `WallSnapBeaconLayer`. Subscribes to the shared `useWallSnapIndicator`
 * store (published by the floor-plan wall draft + endpoint-move handlers) and
 * draws a marker at the snap point whose shape tells you *what* it caught,
 * matching the 3D glyphs:
 *
 *   endpoint (corner) → square    midpoint → triangle
 *   intersection      → ✕ cross   wall body (edge) → circle
 *
 * Indigo to match the 3D beacon, except the corner (endpoint) square which is
 * green to match the alignment guides. Sizes are pixel-budgeted via
 * `unitsPerPixel` so the marker stays a
 * constant size on screen at any zoom. Mounted inside the `data-floorplan-scene`
 * group so coordinates are world meters (XZ) 1:1, like the alignment guides.
 */
const COLOR = '#6366f1' // indigo-500 — matches the 3D beacon
const ENDPOINT_COLOR = '#22c55e' // green-500 — corner (endpoint) snap accent

export const FloorplanSnapBeaconLayer = memo(function FloorplanSnapBeaconLayer() {
  const point = useWallSnapIndicator((s) => s.point)
  const ctx = useFloorplanRender()

  if (!point) return null

  const upp = ctx?.unitsPerPixel ?? 0.01
  const m = 6 * upp // base half-size of the glyph in world meters
  const stroke = 1.5 * upp

  return (
    <g pointerEvents="none">
      <SnapMarker color={COLOR} kind={point.kind} m={m} stroke={stroke} x={point.x} z={point.z} />
    </g>
  )
})

function SnapMarker({
  color,
  kind,
  m,
  stroke,
  x,
  z,
}: {
  color: string
  kind: WallSnapKind
  m: number
  stroke: number
  x: number
  z: number
}) {
  if (kind === 'endpoint') {
    return <rect fill={ENDPOINT_COLOR} height={m * 2} width={m * 2} x={x - m} y={z - m} />
  }
  if (kind === 'midpoint') {
    const t = m * 1.3
    const points = `${x},${z - t} ${x - t},${z + t} ${x + t},${z + t}`
    return <polygon fill={color} points={points} />
  }
  if (kind === 'intersection') {
    const c = m * 1.4
    return (
      <g stroke={color} strokeLinecap="round" strokeWidth={stroke * 2}>
        <line x1={x - c} x2={x + c} y1={z - c} y2={z + c} />
        <line x1={x - c} x2={x + c} y1={z + c} y2={z - c} />
      </g>
    )
  }
  // 'wall' (edge / along-wall) → circle
  return <circle cx={x} cy={z} fill={color} r={m} />
}
