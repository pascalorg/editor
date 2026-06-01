import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'

// Offset from the stair's footprint edge to the rotation chevron's
// origin. Same magnitude as `STAIR_ROTATE_CORNER_OFFSET` in
// `definition.ts` so the 2D handle visually lines up with where the 3D
// curved-arrow gizmo would sit at the matching world point.
const STAIR_ROTATE_PLAN_OFFSET = 0.4

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

      // Per-segment side + length resize arrows. Mirror of the 3D
      // `StairSegmentSideArrow` / `StairSegmentLengthArrow` handles
      // (~lines 235 / 375 of stair-segment-handles.tsx).
      // Skip when the stair is being placed — placement-mode arrows would
      // compete with the cursor follow.
      if (isSelected && !view?.moving) {
        const poly = segmentEntry.polygon
        // Polygon corners (from `getFloorplanStairSegmentPolygon`):
        //   0 back-left   1 back-right
        //   3 front-left  2 front-right
        const c0 = poly[0]
        const c1 = poly[1]
        const c2 = poly[2]
        const c3 = poly[3]
        if (c0 && c1 && c2 && c3) {
          const width = segmentEntry.segment.width || 1
          const length = segmentEntry.segment.length || 1
          // Segment-local +X (width axis) and +Z (run axis) in plan coords,
          // captured here so the affordance handler can project pointer
          // deltas without re-walking the stair chain.
          const axisX: readonly [number, number] = [(c1.x - c0.x) / width, (c1.y - c0.y) / width]
          const axisZ: readonly [number, number] = [(c3.x - c0.x) / length, (c3.y - c0.y) / length]
          const rightMid: [number, number] = [(c1.x + c2.x) / 2, (c1.y + c2.y) / 2]
          const leftMid: [number, number] = [(c0.x + c3.x) / 2, (c0.y + c3.y) / 2]
          const frontEdgeMid: [number, number] = [(c2.x + c3.x) / 2, (c2.y + c3.y) / 2]
          // Offset the length arrow's base OUT past the front edge so the
          // shaft+head sit entirely beyond the stair body. The arrow path's
          // own `bi` inset is only 0.03 m — short enough that the head can
          // still overlap the stair fill at common zooms, which reads as
          // "the arrow is lying along the edge / pointing sideways" instead
          // of clearly pointing forward off the run. Pushing the anchor
          // along +axisZ removes that ambiguity.
          const segmentLengthArrowOffset = 0.06
          const frontArrowAnchor: [number, number] = [
            frontEdgeMid[0] + axisZ[0] * segmentLengthArrowOffset,
            frontEdgeMid[1] + axisZ[1] * segmentLengthArrowOffset,
          ]
          const segmentId = segmentEntry.segment.id
          children.push({
            kind: 'move-arrow',
            point: rightMid,
            angle: Math.atan2(axisX[1], axisX[0]),
            affordance: 'segment-width',
            payload: { segmentId, side: 'right', axisX },
          })
          children.push({
            kind: 'move-arrow',
            point: leftMid,
            angle: Math.atan2(-axisX[1], -axisX[0]),
            affordance: 'segment-width',
            payload: { segmentId, side: 'left', axisX },
          })
          // Length arrow — anchored just past the front edge, pointing in
          // the segment's run direction (axisZ = back-to-front). After the
          // SVG `rotate(angle)`, the arrow's local +X (its tip) lines up
          // with +axisZ, so the head clearly extends forward off the front
          // edge instead of sideways across it.
          children.push({
            kind: 'move-arrow',
            point: frontArrowAnchor,
            angle: Math.atan2(axisZ[1], axisZ[0]),
            affordance: 'segment-length',
            payload: { segmentId, axisZ },
          })
        }
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
    // SVG `A` (arc) draws a single sub-360° segment. Once the base sweep
    // is near a full turn and we add up to 0.75π of integrated landing
    // on top, the total `visualSectorEnd - sectorStart` overflows 2π and
    // the path becomes malformed (the whole stair chrome breaks). Cap
    // the COMBINED visual sweep to just under a full revolution — past
    // that, the landing visually overlaps the start of the arc, which
    // is exactly the multi-turn "stack on top of each other" behaviour
    // we want for spirals with > 360° rotation.
    const rawVisualSweep = normalizedSweepAngle + spiralLandingSweep
    const sweepCap = Math.PI * 2 - 0.001
    const visualSweep =
      Math.sign(rawVisualSweep || 1) * Math.min(Math.abs(rawVisualSweep), sweepCap)
    const visualSectorEndAngle = sectorStartAngle + visualSweep
    const stairCenter = { x: stair.position[0], y: stair.position[2] }
    const innerRadius = Math.max(
      stairType === 'spiral' ? 0.05 : 0.2,
      stair.innerRadius ?? (stairType === 'spiral' ? 0.2 : 0.9),
    )
    const outerRadius = innerRadius + stair.width
    const centerlineRadius = innerRadius + stair.width / 2

    // Stroke widths are screen pixels (paired with `vectorEffect:
    // 'non-scaling-stroke'` below). World-metre values like 0.02 would
    // render as sub-pixel — invisible at every zoom. Matches the legacy
    // `<FloorplanStairLayer>` curved/spiral branches.
    const outerArcWidth = showSelectedChrome ? 2 : 1.4
    const innerArcWidth = showSelectedChrome ? 1.7 : 1.2

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
      strokeWidth: outerArcWidth,
      vectorEffect: 'non-scaling-stroke',
    })
    children.push({
      kind: 'path',
      d: buildSvgArcPath(stairCenter, innerRadius, sectorStartAngle, visualSectorEndAngle),
      fill: 'none',
      stroke: stairStroke,
      strokeWidth: innerArcWidth,
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
      const isFirst = index === 0
      // Curved: regular stroke everywhere, but both the starting and the
      // ending step lines are bolded (matches the legacy
      // `<FloorplanStairLayer>` curved branch).
      // Spiral: only the last step is accented + bolded; intermediate
      // steps past `dashedFromIndex` are dashed.
      const isEmphasised = stairType === 'spiral' ? isLast : isFirst || isLast
      const stepWidth =
        stairType === 'spiral' ? (isEmphasised ? 1.8 : 1.15) : isEmphasised ? 1.5 : 1.1
      children.push({
        kind: 'line',
        x1: inner.x,
        y1: inner.y,
        x2: outer.x,
        y2: outer.y,
        stroke: stairType === 'spiral' && isLast ? stairAccent : stairStroke,
        strokeWidth: stepWidth,
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
        strokeWidth: 1.1,
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
        strokeWidth: 1.2,
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

    // 7. Resize arrows — mirror of the 3D `CurvedStairWidthArrow`,
    //    `CurvedStairInnerRadiusArrow`, and two `CurvedStairSweepArrow`s.
    //    Hidden during placement (`view?.moving`) so they don't fight the
    //    cursor follow.
    if (isSelected && !view?.moving) {
      const midAngle = (sectorStartAngle + sectorEndAngle) / 2
      const sweepSign = Math.sign(normalizedSweepAngle) || 1
      // Width arrow — radially outward at the sweep bisector, on the outer rim.
      const widthAnchor = getArcPlanPoint(stairCenter, outerRadius, midAngle)
      children.push({
        kind: 'move-arrow',
        point: [widthAnchor.x, widthAnchor.y],
        angle: midAngle,
        affordance: 'curved-width',
        payload: { kind: 'width' },
      })

      // Inner-radius arrow — just inside the inner edge, chevron pointing
      // toward the centre. Skip for very tight spirals where there's no
      // room (chevron would tunnel through the central column).
      if (innerRadius > 0.18) {
        const innerArrowRadius = Math.max(innerRadius - 0.04, innerRadius * 0.45)
        const innerAnchor = getArcPlanPoint(stairCenter, innerArrowRadius, midAngle)
        children.push({
          kind: 'move-arrow',
          point: [innerAnchor.x, innerAnchor.y],
          angle: midAngle + Math.PI,
          affordance: 'curved-inner-radius',
          payload: { kind: 'inner-radius' },
        })
      }

      // Sweep arrows — anchored at the actual sweep ends on the outer rim,
      // chevrons pointing tangentially in the grow direction. (3D clusters
      // them next to the width arrow because the camera-facing rim is
      // easier to grab; in plan we have the whole arc visible, so the
      // ends are the natural placement.)
      const sweepEndAnchor = getArcPlanPoint(stairCenter, outerRadius, sectorEndAngle)
      children.push({
        kind: 'move-arrow',
        point: [sweepEndAnchor.x, sweepEndAnchor.y],
        angle: sectorEndAngle + sweepSign * (Math.PI / 2),
        affordance: 'curved-sweep',
        payload: { end: 'end' },
      })
      const sweepStartAnchor = getArcPlanPoint(stairCenter, outerRadius, sectorStartAngle)
      children.push({
        kind: 'move-arrow',
        point: [sweepStartAnchor.x, sweepStartAnchor.y],
        angle: sectorStartAngle - sweepSign * (Math.PI / 2),
        affordance: 'curved-sweep',
        payload: { end: 'start' },
      })
    }
  }

  // Direction arrow — emitted by `buildFloorplanStairEntry` as a polyline
  // (the spine) plus a polygon (the head). Tells the user which way
  // "up" is at a glance. Skip for curved / spiral: those already draw
  // their own arc-aligned arrow above; `buildFloorplanStairArrow` traces
  // the stair-segment chain in straight space and produces a malformed
  // polyline once the chain is laid around an arc.
  if (stairType === 'straight' && entry.arrow) {
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

  // Whole-stair rotation handle — sister to the 3D `stairRotateHandle`
  // (arc-resize, curved-arrow). 2D doesn't have a dedicated curved-arrow
  // primitive, so we emit a `move-arrow` with the `'stair-rotate'`
  // affordance: the chevron sits at the stair's outer corner and a drag
  // around the stair centre rotates the whole node. Placement mirrors
  // the 3D handle:
  //   - straight: at the +X / -Z corner of the run start
  //   - curved / spiral: outer rim at the sweep-start side
  // Position is computed in stair-local coords then rotated into plan
  // coords by `R(-θ)` — matches the convention the curved sector emitter
  // already uses (`sectorStartAngle = -stair.rotation - sweep/2`).
  if (isSelected && !view?.moving) {
    const cos = Math.cos(stair.rotation)
    const sin = Math.sin(stair.rotation)
    const cx = stair.position[0]
    const cz = stair.position[2]
    let localX: number
    let localZ: number
    if (stairType === 'straight') {
      const stairWidth = Math.max(stair.width ?? 1, 0.4)
      localX = stairWidth / 2 + STAIR_ROTATE_PLAN_OFFSET
      localZ = -STAIR_ROTATE_PLAN_OFFSET
    } else {
      const isSpiral = stairType === 'spiral'
      const innerR = Math.max(isSpiral ? 0.05 : 0.2, stair.innerRadius ?? (isSpiral ? 0.2 : 0.9))
      const outerR = innerR + (stair.width ?? 1)
      const sweep = stair.sweepAngle ?? (isSpiral ? Math.PI * 2 : Math.PI / 2)
      const radius = outerR + STAIR_ROTATE_PLAN_OFFSET
      const localAngle = -sweep / 2
      localX = radius * Math.cos(localAngle)
      localZ = radius * Math.sin(localAngle)
    }
    const planX = cx + localX * cos + localZ * sin
    const planY = cz - localX * sin + localZ * cos
    // The `rotate-arrow` icon is designed in a local frame where +X is
    // the radial-outward direction from the pivot. `angle` selects that
    // direction in plan coords; the arrowheads then read as tangential
    // motion around the stair centre.
    const radialAngle = Math.atan2(planY - cz, planX - cx)
    children.push({
      kind: 'rotate-arrow',
      point: [planX, planY],
      angle: radialAngle,
      affordance: 'stair-rotate',
      pivot: [cx, cz],
    })
  }

  // Move handle — orange dot at the stair root position. Same UX as
  // every other kind's `move-handle`: click to enter cursor-follow
  // mode, click again to commit.
  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [stair.position[0], stair.position[2]],
    })
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
