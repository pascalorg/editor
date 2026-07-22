'use client'

import { type FloorplanGeometry, loadAssetUrl } from '@pascal-app/core'
import { memo, useEffect, useState } from 'react'
import { readFloorplanGeometryMetadata } from '../../../lib/floorplan/floorplan-extension'
import {
  floorplanAnnotationObstacleMode,
  isFloorplanAnnotationObstacleGeometry,
} from './floorplan-annotation-layout'
import {
  FloorplanDimensionRenderer,
  FloorplanDimensionStringRenderer,
} from './floorplan-dimension-renderer'
import { resolveFloorplanLabelAngle } from './floorplan-label-angle'

const STATIC_LABEL_UNITS_PER_PIXEL = 0.01
const DOCUMENT_DEFAULT_TEXT_SIZE_PT = 8
const DOCUMENT_ROOM_NAME_TEXT_SIZE_PT = 8
const DOCUMENT_ROOM_NUMBER_TEXT_SIZE_PT = 7
const DOCUMENT_ROOM_DETAIL_TEXT_SIZE_PT = 5.5
const DOCUMENT_COLUMN_MARK_TEXT_SIZE_PT = 7
const DOCUMENT_DEFAULT_STROKE_WIDTH_PT = 0.5
const DOCUMENT_TEXT_OUTLINE_MIN_WIDTH_PT = 0.75
const DOCUMENT_MARK_HEIGHT_PT = 14
const PDF_ANNOTATION_STROKE_WIDTH_PT = 0.5

type FloorplanRenderMode = 'screen' | 'pdf'

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
  sceneRotationDeg = 0,
  annotationUnitsPerPoint,
  screenUnitsPerPixel,
  renderMode = 'screen',
}: {
  geometry: FloorplanGeometry
  pointerEventsOverride?: string
  sceneRotationDeg?: number
  annotationUnitsPerPoint?: number
  screenUnitsPerPixel?: number
  renderMode?: FloorplanRenderMode
}) {
  return renderNode(
    geometry,
    0,
    pointerEventsOverride,
    sceneRotationDeg,
    annotationUnitsPerPoint,
    screenUnitsPerPixel,
    renderMode,
  )
})

function styleAttrs(
  g: FloorplanGeometry & { kind: Exclude<FloorplanGeometry['kind'], 'group'> },
  pointerEventsOverride?: string,
  annotationUnitsPerPoint?: number,
  renderMode: FloorplanRenderMode = 'screen',
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
  const annotationMetadata = readFloorplanGeometryMetadata(g)
  const documentStyle = resolveDocumentFloorplanAnnotationStyle(g, annotationUnitsPerPoint)
  const vectorEffect = documentStyle.vectorEffect ?? s.vectorEffect
  const resolvedStrokeWidth = documentStyle.strokeWidth ?? s.strokeWidth
  const strokeWidth =
    renderMode === 'pdf' &&
    vectorEffect === 'non-scaling-stroke' &&
    resolvedStrokeWidth !== undefined
      ? Math.min(PDF_ANNOTATION_STROKE_WIDTH_PT, resolvedStrokeWidth)
      : resolvedStrokeWidth
  return {
    'data-floorplan-annotation-obstacle': floorplanAnnotationObstacleMode(g),
    'data-floorplan-annotation-role': annotationMetadata.annotationRole,
    fill: documentStyle.fill ?? s.fill ?? 'none',
    fillOpacity: s.fillOpacity,
    stroke: documentStyle.stroke ?? s.stroke,
    strokeWidth,
    strokeDasharray: s.strokeDasharray,
    strokeLinecap: s.strokeLinecap,
    strokeLinejoin: s.strokeLinejoin,
    strokeOpacity: s.strokeOpacity,
    opacity: s.opacity,
    vectorEffect,
    pointerEvents: pointerEventsOverride ?? s.pointerEvents,
    style: s.cursor ? { cursor: s.cursor } : undefined,
  }
}

export function resolveDocumentFloorplanAnnotationStyle(
  geometry: FloorplanGeometry & { kind: Exclude<FloorplanGeometry['kind'], 'group'> },
  annotationUnitsPerPoint?: number,
): {
  fill?: string
  stroke?: string
  strokeWidth?: number
  vectorEffect?: 'non-scaling-stroke'
} {
  if (annotationUnitsPerPoint === undefined) return {}
  const styled = geometry as FloorplanGeometry & {
    stroke?: string
    strokeWidth?: number
    vectorEffect?: 'non-scaling-stroke'
  }
  if (!styled.stroke && geometry.kind !== 'text') return {}

  if (geometry.kind === 'text') {
    const sourceFontSize = Math.max(geometry.fontSize, 1e-6)
    const sourceStrokeWidth = geometry.strokeWidth ?? 0
    const outlineRatio = sourceStrokeWidth > 0 ? sourceStrokeWidth / sourceFontSize : 0
    const fontSize = documentTextFontSize(geometry, annotationUnitsPerPoint)
    return {
      strokeWidth:
        geometry.stroke && outlineRatio > 0
          ? Math.max(
              DOCUMENT_TEXT_OUTLINE_MIN_WIDTH_PT * annotationUnitsPerPoint,
              fontSize * outlineRatio,
            )
          : undefined,
    }
  }

  return {
    strokeWidth: documentStrokeWidth(styled, annotationUnitsPerPoint),
    vectorEffect: 'non-scaling-stroke',
  }
}

function documentTextFontSize(
  geometry: Extract<FloorplanGeometry, { kind: 'text' }>,
  annotationUnitsPerPoint: number,
): number {
  return documentTextSizePt(geometry) * annotationUnitsPerPoint
}

function documentTextSizePt(geometry: Extract<FloorplanGeometry, { kind: 'text' }>): number {
  switch (readFloorplanGeometryMetadata(geometry).annotationRole) {
    case 'room-label':
      if (geometry.fontSize >= 0.18) return DOCUMENT_ROOM_NAME_TEXT_SIZE_PT
      if (geometry.fontSize >= 0.145) return DOCUMENT_ROOM_NUMBER_TEXT_SIZE_PT
      return DOCUMENT_ROOM_DETAIL_TEXT_SIZE_PT
    case 'column-center':
    case 'stair-annotation':
      return DOCUMENT_COLUMN_MARK_TEXT_SIZE_PT
    default:
      return DOCUMENT_DEFAULT_TEXT_SIZE_PT
  }
}

function documentStrokeWidth(
  geometry: { strokeWidth?: number },
  annotationUnitsPerPoint: number,
): number {
  return Math.max(DOCUMENT_DEFAULT_STROKE_WIDTH_PT, Math.min(1.2, geometry.strokeWidth ?? 0.5))
}

export function documentRectGeometryAttrs(
  geometry: Extract<FloorplanGeometry, { kind: 'rect' }>,
  annotationUnitsPerPoint?: number,
) {
  if (annotationUnitsPerPoint === undefined || !isAnnotationMarkRect(geometry)) {
    return {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rx: geometry.rx,
      ry: geometry.ry,
    }
  }

  const centerX = geometry.x + geometry.width / 2
  const centerY = geometry.y + geometry.height / 2
  const height = DOCUMENT_MARK_HEIGHT_PT * annotationUnitsPerPoint
  const width = Math.max(height * 1.6, (geometry.width / Math.max(geometry.height, 1e-6)) * height)
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    rx: height / 2,
    ry: height / 2,
  }
}

function isAnnotationMarkRect(geometry: Extract<FloorplanGeometry, { kind: 'rect' }>): boolean {
  return geometry.fill === '#ffffff' && !!geometry.stroke && geometry.height <= 0.5
}

export function documentCircleGeometryAttrs(
  geometry: Extract<FloorplanGeometry, { kind: 'circle' }>,
  annotationUnitsPerPoint?: number,
) {
  if (annotationUnitsPerPoint === undefined || !isAnnotationMarkCircle(geometry)) {
    return { r: geometry.r }
  }
  return { r: Math.max(geometry.r, (DOCUMENT_MARK_HEIGHT_PT / 2) * annotationUnitsPerPoint) }
}

function isAnnotationMarkCircle(geometry: Extract<FloorplanGeometry, { kind: 'circle' }>): boolean {
  return geometry.fill === '#ffffff' && !!geometry.stroke && geometry.r <= 0.25
}

export function resolveDocumentAnnotationGroupChildren(
  children: FloorplanGeometry[],
  annotationUnitsPerPoint?: number,
): FloorplanGeometry[] {
  if (annotationUnitsPerPoint === undefined) return children

  const next = [...children]
  let start = 0
  while (start < next.length) {
    const first = next[start]
    if (!isDocumentTextLine(first)) {
      start++
      continue
    }

    let end = start + 1
    while (end < next.length && isSameDocumentTextRun(first, next[end])) end++
    if (end - start > 1) {
      const run = next.slice(start, end) as Extract<FloorplanGeometry, { kind: 'text' }>[]
      const adjusted = positionDocumentTextRun(run, annotationUnitsPerPoint)
      for (let index = 0; index < adjusted.length; index++) {
        const line = adjusted[index]
        if (line) next[start + index] = line
      }
    }
    start = end
  }

  return next
}

function isDocumentTextLine(
  geometry: FloorplanGeometry | undefined,
): geometry is Extract<FloorplanGeometry, { kind: 'text' }> {
  return geometry?.kind === 'text' && geometry.upright === true
}

function isSameDocumentTextRun(
  first: Extract<FloorplanGeometry, { kind: 'text' }>,
  candidate: FloorplanGeometry | undefined,
): candidate is Extract<FloorplanGeometry, { kind: 'text' }> {
  return (
    isDocumentTextLine(candidate) &&
    Math.abs(candidate.x - first.x) < 1e-6 &&
    candidate.textAnchor === first.textAnchor &&
    readFloorplanGeometryMetadata(candidate).annotationRole ===
      readFloorplanGeometryMetadata(first).annotationRole
  )
}

function positionDocumentTextRun(
  run: Extract<FloorplanGeometry, { kind: 'text' }>[],
  annotationUnitsPerPoint: number,
): Extract<FloorplanGeometry, { kind: 'text' }>[] {
  const centerY = run.reduce((sum, line) => sum + line.y, 0) / run.length
  const steps = run.slice(0, -1).map((line, index) => {
    const next = run[index + 1] ?? line
    const largerFontPt = Math.max(documentTextSizePt(line), documentTextSizePt(next))
    return largerFontPt * 1.25 * annotationUnitsPerPoint
  })
  const totalHeight = steps.reduce((sum, step) => sum + step, 0)
  let y = centerY - totalHeight / 2
  return run.map((line, index) => {
    if (index > 0) y += steps[index - 1] ?? 0
    return { ...line, y }
  })
}

function renderNode(
  g: FloorplanGeometry,
  keyHint: number,
  pointerEventsOverride?: string,
  sceneRotationDeg = 0,
  annotationUnitsPerPoint?: number,
  screenUnitsPerPixel?: number,
  renderMode: FloorplanRenderMode = 'screen',
): React.ReactElement | null {
  switch (g.kind) {
    case 'path':
      return (
        <path
          d={g.d}
          key={keyHint}
          {...styleAttrs(g, pointerEventsOverride, annotationUnitsPerPoint, renderMode)}
        />
      )

    case 'polygon':
      return (
        <polygon
          key={keyHint}
          points={pointsToAttr(g.points)}
          {...styleAttrs(g, pointerEventsOverride, annotationUnitsPerPoint, renderMode)}
        />
      )

    case 'polyline':
      return (
        <polyline
          key={keyHint}
          points={pointsToAttr(g.points)}
          {...styleAttrs(g, pointerEventsOverride, annotationUnitsPerPoint, renderMode)}
        />
      )

    case 'rect': {
      const attrs = documentRectGeometryAttrs(g, annotationUnitsPerPoint)
      return (
        <rect
          height={attrs.height}
          key={keyHint}
          rx={attrs.rx}
          ry={attrs.ry}
          width={attrs.width}
          x={attrs.x}
          y={attrs.y}
          {...styleAttrs(g, pointerEventsOverride, annotationUnitsPerPoint, renderMode)}
        />
      )
    }

    case 'circle': {
      const attrs = documentCircleGeometryAttrs(g, annotationUnitsPerPoint)
      return (
        <circle
          cx={g.cx}
          cy={g.cy}
          key={keyHint}
          r={attrs.r}
          {...styleAttrs(g, pointerEventsOverride, annotationUnitsPerPoint, renderMode)}
        />
      )
    }

    case 'line':
      return (
        <line
          key={keyHint}
          x1={g.x1}
          x2={g.x2}
          y1={g.y1}
          y2={g.y2}
          {...styleAttrs(g, pointerEventsOverride, annotationUnitsPerPoint, renderMode)}
        />
      )

    case 'text': {
      const fontSize =
        annotationUnitsPerPoint !== undefined
          ? documentTextFontSize(g, annotationUnitsPerPoint)
          : g.fontSize
      const textStyle = resolveDocumentFloorplanAnnotationStyle(g, annotationUnitsPerPoint)
      const pdfOutlinedText = renderMode === 'pdf' && g.paintOrder === 'stroke' && !!g.stroke
      const fill =
        pdfOutlinedText && g.fill?.toLocaleLowerCase() === '#ffffff'
          ? g.stroke
          : (g.fill ?? '#171717')
      if (g.upright) {
        return (
          <g
            data-floorplan-annotation-obstacle={floorplanAnnotationObstacleMode(g)}
            key={keyHint}
            transform={`translate(${g.x} ${g.y}) rotate(${-sceneRotationDeg})`}
          >
            <text
              dominantBaseline={g.dominantBaseline ?? 'middle'}
              fill={fill}
              fontFamily={g.fontFamily}
              fontSize={fontSize}
              fontWeight={g.fontWeight}
              opacity={g.opacity}
              paintOrder={pdfOutlinedText ? undefined : g.paintOrder}
              pointerEvents={pointerEventsOverride}
              stroke={pdfOutlinedText ? undefined : g.stroke}
              strokeLinecap={!pdfOutlinedText && g.stroke ? 'round' : undefined}
              strokeLinejoin={!pdfOutlinedText && g.stroke ? 'round' : undefined}
              strokeWidth={pdfOutlinedText ? undefined : (textStyle.strokeWidth ?? g.strokeWidth)}
              textAnchor={g.textAnchor ?? 'start'}
              x={0}
              y={0}
            >
              {g.text}
            </text>
          </g>
        )
      }
      return (
        <text
          data-floorplan-annotation-obstacle={floorplanAnnotationObstacleMode(g)}
          dominantBaseline={g.dominantBaseline ?? 'middle'}
          fill={fill}
          fontFamily={g.fontFamily}
          fontSize={fontSize}
          fontWeight={g.fontWeight}
          key={keyHint}
          opacity={g.opacity}
          paintOrder={pdfOutlinedText ? undefined : g.paintOrder}
          stroke={pdfOutlinedText ? undefined : g.stroke}
          strokeLinecap={!pdfOutlinedText && g.stroke ? 'round' : undefined}
          strokeLinejoin={!pdfOutlinedText && g.stroke ? 'round' : undefined}
          strokeWidth={pdfOutlinedText ? undefined : (textStyle.strokeWidth ?? g.strokeWidth)}
          textAnchor={g.textAnchor ?? 'start'}
          pointerEvents={pointerEventsOverride}
          x={g.x}
          y={g.y}
        >
          {g.text}
        </text>
      )
    }

    case 'dimension':
      return (
        <FloorplanDimensionRenderer
          geometry={g}
          key={keyHint}
          sceneRotationDeg={sceneRotationDeg}
          annotationUnitsPerPoint={annotationUnitsPerPoint}
          renderMode={renderMode}
        />
      )

    case 'dimension-string':
      return (
        <FloorplanDimensionStringRenderer
          annotationUnitsPerPoint={annotationUnitsPerPoint}
          geometry={g}
          key={keyHint}
          renderMode={renderMode}
          sceneRotationDeg={sceneRotationDeg}
        />
      )

    case 'dimension-label': {
      const unitsPerPixel =
        annotationUnitsPerPoint ?? screenUnitsPerPixel ?? STATIC_LABEL_UNITS_PER_PIXEL
      const documentMode = annotationUnitsPerPoint !== undefined
      const outlined = g.appearance === 'outlined'
      const pdfOutlined = outlined && renderMode === 'pdf'
      const padX = unitsPerPixel * 6
      const padY = unitsPerPixel * 3
      const fontSize = unitsPerPixel * (documentMode ? 8 : outlined ? 12 : 10)
      const textWidth = g.text.length * unitsPerPixel * 6.2
      const plateW = textWidth + padX * 2
      const plateH = fontSize + padY * 2
      const degrees = resolveFloorplanLabelAngle(g.angle, sceneRotationDeg, g.screenUpright)
      const labelTransform = `translate(${g.cx} ${g.cy}) rotate(${degrees}) translate(0 ${-(g.offsetPx ?? 0) * unitsPerPixel})`

      return (
        <g
          data-floorplan-annotation-default-transform={labelTransform}
          data-floorplan-annotation-label=""
          data-floorplan-annotation-priority="20"
          key={keyHint}
          pointerEvents="none"
          transform={labelTransform}
        >
          {outlined && !pdfOutlined ? null : (
            <rect
              data-floorplan-dimension-label-plate={pdfOutlined ? '' : undefined}
              fill="#ffffff"
              height={plateH}
              opacity={0.92}
              rx={unitsPerPixel * 3}
              ry={unitsPerPixel * 3}
              stroke={pdfOutlined ? undefined : '#334155'}
              strokeWidth={pdfOutlined ? undefined : unitsPerPixel * 0.5}
              width={plateW}
              x={-plateW / 2}
              y={-plateH / 2}
            />
          )}
          <text
            dominantBaseline="middle"
            fill={pdfOutlined ? '#111827' : outlined ? '#ffffff' : '#111827'}
            fontFamily={
              outlined && !pdfOutlined
                ? 'system-ui, -apple-system, sans-serif'
                : 'ui-monospace, SFMono-Regular, Menlo, monospace'
            }
            fontSize={fontSize}
            fontWeight={outlined ? 500 : 600}
            paintOrder={outlined && !pdfOutlined ? 'stroke' : undefined}
            stroke={outlined && !pdfOutlined ? '#334155' : undefined}
            strokeLinecap={outlined && !pdfOutlined ? 'round' : undefined}
            strokeLinejoin={outlined && !pdfOutlined ? 'round' : undefined}
            strokeWidth={outlined && !pdfOutlined ? fontSize * 0.35 : undefined}
            textAnchor="middle"
            x={0}
            y={0}
          >
            {g.text}
          </text>
        </g>
      )
    }

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
      const children = resolveDocumentAnnotationGroupChildren(g.children, annotationUnitsPerPoint)
      return (
        <g
          data-floorplan-annotation-obstacle={
            isFloorplanAnnotationObstacleGeometry(g) ? '' : undefined
          }
          key={keyHint}
          transform={transform}
        >
          {children.map((child, i) =>
            renderNode(
              child,
              i,
              pointerEventsOverride,
              sceneRotationDeg,
              annotationUnitsPerPoint,
              screenUnitsPerPixel,
              renderMode,
            ),
          )}
        </g>
      )
    }

    // The remaining interactive primitives (hatch / hit-line / endpoint-handle)
    // need the SVG context + theme palette + units-per-
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
