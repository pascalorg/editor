'use client'

import type { FloorplanGeometry } from '@pascal-app/core'
import { memo } from 'react'

/**
 * Pure-data → SVG converter. Walks a `FloorplanGeometry` tree returned by
 * `def.floorplan(node, ctx)` and emits the matching React-SVG nodes.
 *
 * Coordinates are level-local meters. The wrapping floor-plan panel
 * applies the world→SVG transform via its viewBox, so kinds emit
 * geometry in the same units they reason about in 3D.
 *
 * Group transforms compose: `transform={translate(x y) rotate(deg)}`.
 * Rotations are radians at the data layer (consistent with three.js
 * conventions used by `def.geometry`) and converted to degrees for SVG
 * here — kinds never touch units.
 *
 * Styling props map straight onto SVG attributes. Builders that need
 * theme colors should declare them inline or expose them as registry
 * tokens later (deferred until a real need surfaces — AI-authored kinds
 * can pick safe defaults today).
 */
export const FloorplanGeometryRenderer = memo(function FloorplanGeometryRenderer({
  geometry,
}: {
  geometry: FloorplanGeometry
}) {
  return renderNode(geometry, 0)
})

function renderNode(g: FloorplanGeometry, keyHint: number): React.ReactElement | null {
  switch (g.kind) {
    case 'path':
      return (
        <path
          d={g.d}
          fill={g.fill ?? 'none'}
          key={keyHint}
          opacity={g.opacity}
          stroke={g.stroke}
          strokeDasharray={g.strokeDasharray}
          strokeWidth={g.strokeWidth}
        />
      )

    case 'polygon':
      return (
        <polygon
          fill={g.fill ?? 'none'}
          key={keyHint}
          opacity={g.opacity}
          points={pointsToAttr(g.points)}
          stroke={g.stroke}
          strokeDasharray={g.strokeDasharray}
          strokeWidth={g.strokeWidth}
        />
      )

    case 'polyline':
      return (
        <polyline
          fill={g.fill ?? 'none'}
          key={keyHint}
          opacity={g.opacity}
          points={pointsToAttr(g.points)}
          stroke={g.stroke}
          strokeDasharray={g.strokeDasharray}
          strokeWidth={g.strokeWidth}
        />
      )

    case 'rect':
      return (
        <rect
          fill={g.fill ?? 'none'}
          height={g.height}
          key={keyHint}
          opacity={g.opacity}
          rx={g.rx}
          ry={g.ry}
          stroke={g.stroke}
          strokeDasharray={g.strokeDasharray}
          strokeWidth={g.strokeWidth}
          width={g.width}
          x={g.x}
          y={g.y}
        />
      )

    case 'circle':
      return (
        <circle
          cx={g.cx}
          cy={g.cy}
          fill={g.fill ?? 'none'}
          key={keyHint}
          opacity={g.opacity}
          r={g.r}
          stroke={g.stroke}
          strokeDasharray={g.strokeDasharray}
          strokeWidth={g.strokeWidth}
        />
      )

    case 'line':
      return (
        <line
          key={keyHint}
          opacity={g.opacity}
          stroke={g.stroke}
          strokeDasharray={g.strokeDasharray}
          strokeWidth={g.strokeWidth}
          x1={g.x1}
          x2={g.x2}
          y1={g.y1}
          y2={g.y2}
        />
      )

    case 'group': {
      const transform = formatTransform(g.transform)
      return (
        <g key={keyHint} transform={transform}>
          {g.children.map((child, i) => renderNode(child, i))}
        </g>
      )
    }
  }
}

function pointsToAttr(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}

function formatTransform(t?: {
  translate?: readonly [number, number]
  rotate?: number
}): string | undefined {
  if (!t) return undefined
  const parts: string[] = []
  if (t.translate) parts.push(`translate(${t.translate[0]} ${t.translate[1]})`)
  if (t.rotate !== undefined) parts.push(`rotate(${(t.rotate * 180) / Math.PI})`)
  return parts.length > 0 ? parts.join(' ') : undefined
}
