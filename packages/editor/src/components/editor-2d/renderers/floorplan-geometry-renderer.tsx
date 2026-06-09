'use client'

import { type FloorplanGeometry, loadAssetUrl } from '@pascal-app/core'
import { memo, useEffect, useState } from 'react'

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
  pointerEventsOverride,
}: {
  geometry: FloorplanGeometry
  pointerEventsOverride?: string
}) {
  return renderNode(geometry, 0, pointerEventsOverride)
})

function styleAttrs(
  g: FloorplanGeometry & { kind: Exclude<FloorplanGeometry['kind'], 'group'> },
  pointerEventsOverride?: string,
) {
  // Shared SVG attribute mapping for any styled primitive. Keeps the per-
  // primitive switch arms terse and ensures new style fields land
  // everywhere at once. `as any` avoids re-asserting every variant
  // includes the style fields — they all do, except `group` (which is
  // filtered out by the caller's type bound).
  const s = g as unknown as {
    fill?: string
    fillOpacity?: number
    stroke?: string
    strokeWidth?: number
    strokeDasharray?: string
    strokeLinecap?: 'butt' | 'round' | 'square'
    strokeLinejoin?: 'miter' | 'round' | 'bevel'
    strokeOpacity?: number
    opacity?: number
    vectorEffect?: 'non-scaling-stroke'
    pointerEvents?: string
    cursor?: string
  }
  return {
    fill: s.fill ?? 'none',
    fillOpacity: s.fillOpacity,
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    strokeDasharray: s.strokeDasharray,
    strokeLinecap: s.strokeLinecap,
    strokeLinejoin: s.strokeLinejoin,
    strokeOpacity: s.strokeOpacity,
    opacity: s.opacity,
    vectorEffect: s.vectorEffect,
    pointerEvents: pointerEventsOverride ?? s.pointerEvents,
    style: s.cursor ? { cursor: s.cursor } : undefined,
  }
}

function renderNode(
  g: FloorplanGeometry,
  keyHint: number,
  pointerEventsOverride?: string,
): React.ReactElement | null {
  switch (g.kind) {
    case 'path':
      return <path d={g.d} key={keyHint} {...styleAttrs(g, pointerEventsOverride)} />

    case 'polygon':
      return (
        <polygon
          key={keyHint}
          points={pointsToAttr(g.points)}
          {...styleAttrs(g, pointerEventsOverride)}
        />
      )

    case 'polyline':
      return (
        <polyline
          key={keyHint}
          points={pointsToAttr(g.points)}
          {...styleAttrs(g, pointerEventsOverride)}
        />
      )

    case 'rect':
      return (
        <rect
          height={g.height}
          key={keyHint}
          rx={g.rx}
          ry={g.ry}
          width={g.width}
          x={g.x}
          y={g.y}
          {...styleAttrs(g, pointerEventsOverride)}
        />
      )

    case 'circle':
      return (
        <circle
          cx={g.cx}
          cy={g.cy}
          key={keyHint}
          r={g.r}
          {...styleAttrs(g, pointerEventsOverride)}
        />
      )

    case 'line':
      return (
        <line
          key={keyHint}
          x1={g.x1}
          x2={g.x2}
          y1={g.y1}
          y2={g.y2}
          {...styleAttrs(g, pointerEventsOverride)}
        />
      )

    case 'text':
      return (
        <text
          dominantBaseline={g.dominantBaseline ?? 'middle'}
          fill={g.fill ?? '#171717'}
          fontFamily={g.fontFamily}
          fontSize={g.fontSize}
          fontWeight={g.fontWeight}
          key={keyHint}
          opacity={g.opacity}
          paintOrder={g.paintOrder}
          stroke={g.stroke}
          strokeLinecap={g.stroke ? 'round' : undefined}
          strokeLinejoin={g.stroke ? 'round' : undefined}
          strokeWidth={g.strokeWidth}
          textAnchor={g.textAnchor ?? 'start'}
          pointerEvents={pointerEventsOverride}
          x={g.x}
          y={g.y}
        >
          {g.text}
        </text>
      )

    case 'image':
      return (
        <FloorplanImage
          center={g.center}
          height={g.height}
          key={keyHint}
          opacity={g.opacity}
          preserveAspectRatio={g.preserveAspectRatio ?? 'xMidYMid meet'}
          rotation={g.rotation ?? 0}
          url={g.url}
          width={g.width}
        />
      )

    case 'group': {
      const transform = formatTransform(g.transform)
      return (
        <g key={keyHint} transform={transform}>
          {g.children.map((child, i) => renderNode(child, i, pointerEventsOverride))}
        </g>
      )
    }

    // The interactive primitives (hatch / hit-line / endpoint-handle /
    // dimension-label) need the SVG context + theme palette + units-per-
    // pixel that only the registry layer has access to. They're rendered
    // by `floorplan-registry-layer.tsx`'s interactive walker instead. If
    // a caller routes one of these through this pure renderer it
    // silently drops — the static renderer is for static output.
    default:
      return null
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

/**
 * `image` primitive renderer. Resolves the URL asynchronously via
 * `loadAssetUrl` (handles CDN / Supabase storage) and renders an SVG
 * `<image>` centered at `center`, rotated around it, sized in plan-local
 * metres. While the resolution is in flight, renders nothing.
 */
function FloorplanImage({
  url,
  center,
  width,
  height,
  rotation,
  preserveAspectRatio,
  opacity,
}: {
  url: string
  center: readonly [number, number]
  width: number
  height: number
  rotation: number
  preserveAspectRatio: string
  opacity?: number
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!url) {
      setResolvedUrl(null)
      return
    }
    let cancelled = false
    setResolvedUrl(null)
    loadAssetUrl(url).then((next) => {
      if (!cancelled) setResolvedUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [url])
  if (!resolvedUrl) return null
  const rotationDeg = (rotation * 180) / Math.PI
  return (
    <g
      pointerEvents="none"
      transform={`translate(${center[0]} ${center[1]}) rotate(${rotationDeg})`}
    >
      <image
        height={height}
        href={resolvedUrl}
        opacity={opacity}
        preserveAspectRatio={preserveAspectRatio}
        width={width}
        x={-width / 2}
        y={-height / 2}
      />
    </g>
  )
}
