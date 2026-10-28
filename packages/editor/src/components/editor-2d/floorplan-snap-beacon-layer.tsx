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
 *   perpendicular     → ⊥ corner  projection guide → diamond
 *   grid length       → small +
 *
 * Indigo to match the 3D beacon, except the corner (endpoint) square which is
 * green to match the alignment guides. A point that carries a `label` (a wall
 * pulled from a wall end) also names what it caught in a pill beside the
 * glyph. Sizes are pixel-budgeted via `unitsPerPixel` so the marker stays a
 * constant size on screen at any zoom. Mounted inside the `data-floorplan-scene`
 * group so coordinates are world meters (XZ) 1:1, like the alignment guides.
 */
const COLOR = '#6366f1' // indigo-500 — matches the 3D beacon
const ENDPOINT_COLOR = '#22c55e' // green-500 — corner (endpoint) snap accent

export const FloorplanSnapBeaconLayer = memo(function FloorplanSnapBeaconLayer({
  unitsPerPixel,
}: {
  /** The plan's live scale, which keeps a labelled marker screen-sized. */
  unitsPerPixel?: number
}) {
  const point = useWallSnapIndicator((s) => s.point)
  const ctx = useFloorplanRender()

  if (!point) return null

  // A labelled point (a wall pulled from a wall end) is sized on screen.
  const upp = (point.label ? unitsPerPixel : undefined) ?? ctx?.unitsPerPixel ?? 0.01
  const m = 6 * upp // base half-size of the glyph in world meters
  const stroke = 1.5 * upp

  return (
    <g pointerEvents="none">
      <SnapMarker color={COLOR} kind={point.kind} m={m} stroke={stroke} x={point.x} z={point.z} />
      {point.label ? (
        <SnapLabel
          color={point.kind === 'endpoint' ? ENDPOINT_COLOR : COLOR}
          sceneRotationDeg={ctx?.sceneRotationDeg ?? 0}
          text={point.label}
          upp={upp}
          x={point.x}
          z={point.z}
        />
      ) : null}
    </g>
  )
})

/** What the snap caught, in a pill down and to the right of the glyph, kept upright. */
function SnapLabel({
  color,
  sceneRotationDeg,
  text,
  upp,
  x,
  z,
}: {
  color: string
  sceneRotationDeg: number
  text: string
  upp: number
  x: number
  z: number
}) {
  const fontSize = 10.5 * upp
  const padX = 5 * upp
  const width = text.length * fontSize * 0.56 + padX * 2
  const height = fontSize + 6 * upp
  return (
    <g
      transform={`translate(${x} ${z}) rotate(${-sceneRotationDeg}) translate(${12 * upp} ${16 * upp})`}
    >
      <rect fill={color} height={height} rx={3 * upp} width={width} x={0} y={-height / 2} />
      <text
        dominantBaseline="middle"
        fill="#ffffff"
        fontFamily="-apple-system, system-ui, sans-serif"
        fontSize={fontSize}
        fontWeight={600}
        x={padX}
        y={0}
      >
        {text}
      </text>
    </g>
  )
}

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
  if (kind === 'perpendicular') {
    // ⊥ — a base line with an upright from its middle, and the square corner.
    const c = m * 1.3
    return (
      <g fill="none" stroke={color} strokeLinecap="round" strokeWidth={stroke * 1.6}>
        <line x1={x - c} x2={x + c} y1={z} y2={z} />
        <line x1={x} x2={x} y1={z} y2={z - c * 1.4} />
        <polyline
          points={`${x + c * 0.5},${z} ${x + c * 0.5},${z - c * 0.5} ${x},${z - c * 0.5}`}
        />
      </g>
    )
  }
  if (kind === 'alignment') {
    const c = m * 1.2
    return (
      <polygon
        fill="#ffffff"
        points={`${x},${z - c} ${x + c},${z} ${x},${z + c} ${x - c},${z}`}
        stroke={color}
        strokeWidth={stroke * 1.4}
      />
    )
  }
  if (kind === 'grid') {
    const c = m * 0.9
    return (
      <g stroke={color} strokeLinecap="round" strokeWidth={stroke * 1.4}>
        <line x1={x - c} x2={x + c} y1={z} y2={z} />
        <line x1={x} x2={x} y1={z - c} y2={z + c} />
      </g>
    )
  }
  // 'wall' (edge / along-wall) → circle
  return <circle cx={x} cy={z} fill={color} r={m} />
}
