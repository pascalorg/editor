import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'
import {
  buildFloorplanStairEntry,
  buildSvgAnnularSectorPath,
  buildSvgArcPath,
  buildSvgArrowHeadPoints,
  getArcPlanPoint,
} from '@pascal-app/editor'

/**
 * Stage C floor-plan emitter for stair. The stair is the parent; its
 * children are the `stair-segment`s whose transforms are *cumulative*
 * (each flight attaches to the previous segment's end via
 * `computeFloorplanStairSegmentTransforms` — `attachmentSide` rotates
 * the chain ±π/2, segment length advances along the chain). Because no
 * individual segment can compute its polygon in isolation, the stair
 * emits the whole stack as one registry entry; `stair-segment` itself
 * has no `def.floorplan` (the registry layer renders the parent here
 * and skips children that don't ship a builder).
 *
 * The actual cumulative walk + segment / arrow / inner-band / tread-bar
 * geometry lives in `editor/src/lib/floorplan/stairs.ts` via
 * `buildFloorplanStairEntry`. We re-export that from `@pascal-app/editor`
 * and emit `FloorplanGeometry` primitives over its output — same shape
 * pattern the legacy `<FloorplanStairLayer>` consumed, minus the
 * per-pixel SVG drawing (the registry's `FloorplanGeometryRenderer`
 * handles that). Curved + spiral stairs fall back to a single curved
 * hit polygon (`buildFloorplanStairEntry` already returns it); the
 * arc-band rendering with steps along the sweep is not yet ported —
 * a follow-up will add either an `arc` primitive or expose the
 * segment-sampler helpers so we can emit a stitched polyline.
 */
export function buildStairFloorplan(
  stair: StairNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const segments = (ctx.children ?? []).filter(
    (child): child is StairSegmentNode => child.type === 'stair-segment' && child.visible !== false,
  )
  const entry = buildFloorplanStairEntry(stair, segments)
  if (!entry) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  // Stair color set. Matches the legacy `stairFill` / `stairStroke` /
  // `stairAccent` / `stairTread` palette values from floorplan-panel.tsx
  // (light-theme literals). When the registry palette grows stair-
  // specific colors these can move to `palette.stair*`.
  const stairStroke = '#171717'
  const stairAccent = showSelectedChrome && palette ? palette.selectedStroke : '#171717'
  const treadStroke = showSelectedChrome ? '#2563eb' : '#262626'
  const fill = showSelectedChrome ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)'

  const children: FloorplanGeometry[] = []

  // Segment footprints — straight stairs have one polygon per segment.
  // Curved / spiral kinds emit one merged hit polygon (built from the
  // sweep arc inside `buildFloorplanStairEntry.hitPolygons`).
  const stairType = stair.stairType ?? 'straight'
  if (stairType === 'straight') {
    for (const segmentEntry of entry.segments) {
      const points = toFloorplanPoints(segmentEntry.polygon)
      children.push({
        kind: 'polygon',
        points,
        fill,
        fillOpacity: 1,
        stroke: stairStroke,
        strokeWidth: 0.025,
        strokeLinejoin: 'round',
        opacity: 0.9,
      })

      // Inner band — the inset outline that gives stairs the "drawn"
      // look. Same polygon as outer but rendered without fill, slightly
      // accentuated stroke.
      const innerPoints = toFloorplanPoints(segmentEntry.innerPolygon)
      children.push({
        kind: 'polygon',
        points: innerPoints,
        fill: 'none',
        stroke: stairAccent,
        strokeWidth: 0.018,
        strokeLinejoin: 'round',
        opacity: showSelectedChrome ? 0.92 : 0.62,
      })

      // Tread bars — one per visible step inside the segment.
      // `buildFloorplanStairEntry` already returns the thickened
      // polygons; we emit them as filled polygons.
      for (const treadBar of segmentEntry.treadBars) {
        children.push({
          kind: 'polygon',
          points: toFloorplanPoints(treadBar),
          fill: treadStroke,
          stroke: 'none',
          opacity: showSelectedChrome ? 0.88 : 0.6,
        })
      }
    }
  } else {
    // Curved / spiral — full arc-band chrome. Mirrors the legacy
    // `<FloorplanStairLayer>` curved/spiral branches in
    // floorplan-panel.tsx (~line 285+).
    const normalizedSweepAngle = getNormalizedFloorplanStairSweepAngle(stair)
    const sectorStartAngle = -stair.rotation - normalizedSweepAngle / 2
    const sectorEndAngle = sectorStartAngle + normalizedSweepAngle
    const spiralLandingSweep = getFloorplanSpiralLandingSweep(stair, normalizedSweepAngle)
    const visualSectorEndAngle = sectorEndAngle + spiralLandingSweep
    const stairCenter = { x: stair.position[0], y: stair.position[2] }
    const innerRadius = Math.max(
      stairType === 'spiral' ? 0.05 : 0.2,
      stair.innerRadius ?? (stairType === 'spiral' ? 0.2 : 0.9),
    )
    const outerRadius = innerRadius + stair.width
    const centerlineRadius = innerRadius + stair.width / 2

    // 1. Annular sector — the filled shaft footprint.
    children.push({
      kind: 'path',
      d: buildSvgAnnularSectorPath(
        stairCenter,
        innerRadius,
        outerRadius,
        sectorStartAngle,
        visualSectorEndAngle,
      ),
      fill,
      fillOpacity: 1,
      stroke: 'none',
      opacity: 0.92,
    })

    // 2. Outer + inner arcs.
    children.push({
      kind: 'path',
      d: buildSvgArcPath(stairCenter, outerRadius, sectorStartAngle, visualSectorEndAngle),
      fill: 'none',
      stroke: stairStroke,
      strokeWidth: showSelectedChrome ? 0.026 : 0.022,
      vectorEffect: 'non-scaling-stroke',
    })
    children.push({
      kind: 'path',
      d: buildSvgArcPath(stairCenter, innerRadius, sectorStartAngle, visualSectorEndAngle),
      fill: 'none',
      stroke: stairStroke,
      strokeWidth: showSelectedChrome ? 0.022 : 0.018,
      vectorEffect: 'non-scaling-stroke',
    })

    // 3. Step lines (radial spokes).
    const stepBase = stairType === 'spiral' ? 6 : 4
    const stepCount = Math.max(stepBase, Math.round(stair.stepCount ?? 10))
    const stepSweep = normalizedSweepAngle / stepCount
    // For spirals only: the last ~32% of the sweep is dashed (matches
    // the legacy `dashedFromIndex = Math.floor(stepCount * 0.68)`).
    const dashedFromIndex = stairType === 'spiral' ? Math.floor(stepCount * 0.68) : Infinity
    for (let index = 0; index <= stepCount; index += 1) {
      const angle = sectorStartAngle + stepSweep * index
      const inner = getArcPlanPoint(stairCenter, innerRadius, angle)
      const outer = getArcPlanPoint(stairCenter, outerRadius, angle)
      const isLast = index === stepCount
      children.push({
        kind: 'line',
        x1: inner.x,
        y1: inner.y,
        x2: outer.x,
        y2: outer.y,
        stroke: isLast ? stairAccent : stairStroke,
        strokeWidth: isLast ? 0.026 : 0.018,
        strokeDasharray: index >= dashedFromIndex && !isLast ? '0.1 0.08' : undefined,
        vectorEffect: 'non-scaling-stroke',
      })
    }

    // 4. Centerline dashed arc (curved kind only — spiral skips this
    // and gets a small fill-circle at the centre instead).
    if (stairType === 'curved') {
      const margin = stepSweep * 0.55
      children.push({
        kind: 'path',
        d: buildSvgArcPath(
          stairCenter,
          centerlineRadius,
          sectorStartAngle + margin,
          sectorEndAngle - margin,
        ),
        fill: 'none',
        stroke: stairAccent,
        strokeDasharray: '0.08 0.11',
        strokeWidth: 0.018,
        vectorEffect: 'non-scaling-stroke',
      })
    }

    // 5. Spiral kind only: little fill-circle at the center for the
    //    column / pole.
    if (stairType === 'spiral') {
      children.push({
        kind: 'circle',
        cx: stairCenter.x,
        cy: stairCenter.y,
        r: Math.max(innerRadius * 0.18, 0.06),
        fill,
        stroke: stairAccent,
        strokeWidth: 0.018,
        vectorEffect: 'non-scaling-stroke',
      })
    }

    // 6. Direction arrow — head only, at the upper end of the sweep.
    const arrowAngle = visualSectorEndAngle - stepSweep * 0.8
    const arrowPoint = getArcPlanPoint(stairCenter, centerlineRadius, arrowAngle)
    const tangentAngle = arrowAngle + (normalizedSweepAngle >= 0 ? Math.PI / 2 : -Math.PI / 2)
    const arrowSize = clamp(stair.width * (stairType === 'spiral' ? 0.18 : 0.16), 0.1, 0.18)
    const headPts = buildSvgArrowHeadPoints(arrowPoint, tangentAngle, arrowSize)
    children.push({
      kind: 'polygon',
      points: headPts.map((p) => [p.x, p.y] as FloorplanPoint),
      fill: stairAccent,
      stroke: 'none',
    })
  }

  // Direction arrow — emitted by `buildFloorplanStairEntry` as a polyline
  // (the spine) plus a polygon (the head). Tells the user which way
  // "up" is at a glance.
  if (entry.arrow) {
    if (entry.arrow.polyline.length >= 2) {
      children.push({
        kind: 'polyline',
        points: toFloorplanPoints(entry.arrow.polyline),
        fill: 'none',
        stroke: stairAccent,
        strokeWidth: 0.02,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        opacity: showSelectedChrome ? 0.92 : 0.72,
      })
    }
    if (entry.arrow.head.length >= 3) {
      children.push({
        kind: 'polygon',
        points: toFloorplanPoints(entry.arrow.head),
        fill: stairAccent,
        stroke: 'none',
        opacity: showSelectedChrome ? 0.92 : 0.72,
      })
    }
  }

  return { kind: 'group', children }
}

function toFloorplanPoints(points: ReadonlyArray<{ x: number; y: number }>): FloorplanPoint[] {
  return points.map((p) => [p.x, p.y] as FloorplanPoint)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Inlined from `editor/lib/floorplan/stairs.ts` — those are private
// helpers in the legacy file. Both are pure derivations from the stair
// node, so they live with the registry-driven emitter.
function getNormalizedFloorplanStairSweepAngle(stair: StairNode): number {
  const stairType = stair.stairType ?? 'straight'
  const baseSweepAngle = stair.sweepAngle ?? (stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2)
  if (Math.abs(baseSweepAngle) >= Math.PI * 2) {
    return Math.sign(baseSweepAngle || 1) * (Math.PI * 2 - 0.001)
  }
  return baseSweepAngle
}

function getFloorplanSpiralLandingSweep(stair: StairNode, sweepAngle: number): number {
  if (
    (stair.stairType ?? 'straight') !== 'spiral' ||
    (stair.topLandingMode ?? 'none') !== 'integrated'
  ) {
    return 0
  }
  const innerRadius = Math.max(0.05, stair.innerRadius ?? 0.9)
  const width = Math.max(stair.width ?? 1, 0.4)
  const landingDepth = Math.max(0.3, stair.topLandingDepth ?? Math.max(width * 0.9, 0.8))
  return (
    Math.min(Math.PI * 0.75, landingDepth / Math.max(innerRadius + width / 2, 0.1)) *
    Math.sign(sweepAngle || 1)
  )
}
