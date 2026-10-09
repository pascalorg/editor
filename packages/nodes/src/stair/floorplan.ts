import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'
import {
  computeSegmentTransforms,
  measureStairDetail,
  resolveStairArcDimensions,
  resolveStairHandrailPaths,
  resolveStairRailPaths,
  resolveStairWalkingPaths,
  rotateXZ,
} from '@pascal-app/core'

// Offset from the stair's footprint edge to the rotation chevron's
// origin. Same magnitude as `STAIR_ROTATE_CORNER_OFFSET` in
// `definition.ts` so the 2D handle visually lines up with where the 3D
// curved-arrow gizmo would sit at the matching world point.
const STAIR_ROTATE_PLAN_OFFSET = 0.4

import {
  buildSvgAnnularSectorPath,
  buildSvgArcPath,
  buildSvgArrowHeadPoints,
  floorplanGeometryMetadata,
  getArcPlanPoint,
} from '@pascal-app/editor'
import {
  buildStairDocumentation,
  resolveStairPlanDirection,
  resolveStraightStairDirectionArrow,
  stairPlanBreakStep,
} from './documentation'

import { buildFloorplanStairEntry } from './plan-entry'

/** The stair parent emits its complete cumulative segment chain. */
export function buildStairFloorplan(
  rawStair: StairNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const parent = ctx.parent as {
    id?: string
    type?: string
    parentId?: string | null
    position?: [number, number, number]
    rotation?: [number, number, number]
  } | null
  let stair = rawStair
  if (parent && parent.id === rawStair.landscapeSurfaceId && parent.position && parent.rotation) {
    const angle = parent.rotation[1]
    const c = Math.cos(angle),
      s = Math.sin(angle)
    const [x, y, z] = rawStair.position
    stair = {
      ...rawStair,
      parentId: parent.parentId ?? null,
      position: [
        parent.position[0] + c * x + s * z,
        parent.position[1] + y,
        parent.position[2] - s * x + c * z,
      ],
      rotation: rawStair.rotation + angle,
    }
  }
  const segments = (ctx.children ?? [])
    .map((child) => ctx.resolve<StairSegmentNode>(child.id) ?? child)
    .filter(
      (child): child is StairSegmentNode =>
        child.type === 'stair-segment' && child.visible !== false,
    )
  const detail = measureStairDetail(stair, segments)
  const entry = buildFloorplanStairEntry(stair, segments, !!detail.error)
  if (!entry) return null
  if (detail.error)
    return {
      kind: 'group',
      children: [
        ...entry.hitPolygons.map(
          (polygon): FloorplanGeometry => ({
            kind: 'polygon',
            points: toFloorplanPoints(polygon),
            fill: 'none',
            stroke: '#b45309',
            strokeWidth: 0.025,
          }),
        ),
        {
          kind: 'text',
          x: stair.position[0],
          y: stair.position[2],
          text: 'Stair detail unavailable — inspect dimensions',
          fontSize: 0.15,
          fill: '#b45309',
        },
      ],
    }
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
      const breakStep = stairPlanBreakStep(segmentEntry.segment.stepCount)
      for (let treadIndex = 0; treadIndex < segmentEntry.treadBars.length; treadIndex += 1) {
        if (treadIndex + 1 >= breakStep) continue
        const treadBar = segmentEntry.treadBars[treadIndex]!
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
      if (isSelected && !view?.moving && segmentEntry.segment.winder) {
        const index = segments.findIndex((segment) => segment.id === segmentEntry.segment.id),
          transform = computeSegmentTransforms(segments)[index]!
        const angle = stair.rotation + transform.rotation
        const [ax, az] = rotateXZ(1, 0, angle)
        for (const side of ['left', 'right'] as const) {
          const [sx, sz] = rotateXZ(
            ((side === 'right' ? 1 : -1) * segmentEntry.segment.width) / 2,
            0,
            transform.rotation,
          )
          const [wx, wz] = rotateXZ(
            transform.position[0] + sx,
            transform.position[2] + sz,
            stair.rotation,
          )
          children.push({
            kind: 'move-arrow',
            point: [stair.position[0] + wx, stair.position[2] + wz],
            angle: Math.atan2(az, ax) + (side === 'left' ? Math.PI : 0),
            affordance: 'segment-width',
            payload: { segmentId: segmentEntry.segment.id, side, axisX: [ax, az] },
          })
        }
      }
      if (isSelected && !view?.moving && !segmentEntry.segment.winder) {
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
    const layout = resolveStairArcDimensions(stair, 0)
    const normalizedSweepAngle = layout.sweepAngle
    const sectorStartAngle = -stair.rotation - layout.sweepAngle / 2
    const sectorEndAngle = sectorStartAngle + layout.sweepAngle
    const visualSweep =
      Math.sign(layout.sweepAngle || 1) *
      Math.min(Math.abs(layout.sweepAngle + layout.landingSweep + layout.nosingSweep), Math.PI * 2)
    const visualSectorStartAngle = sectorStartAngle - layout.nosingSweep
    const visualSectorEndAngle = visualSectorStartAngle + visualSweep
    const stairCenter = { x: stair.position[0], y: stair.position[2] }
    const { innerRadius, outerRadius, walkingRadius: centerlineRadius } = layout

    // Stroke widths are screen pixels (paired with `vectorEffect:
    // 'non-scaling-stroke'` below). World-metre values like 0.02 would
    // render as sub-pixel — invisible at every zoom.
    const outerArcWidth = showSelectedChrome ? 2 : 1.4
    const innerArcWidth = showSelectedChrome ? 1.7 : 1.2

    // 1. Annular sector — the filled shaft footprint.
    children.push({
      kind: 'path',
      d: buildSvgAnnularSectorPath(
        stairCenter,
        innerRadius,
        outerRadius,
        visualSectorStartAngle,
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
      d: buildSvgArcPath(stairCenter, outerRadius, visualSectorStartAngle, visualSectorEndAngle),
      fill: 'none',
      stroke: stairStroke,
      strokeWidth: outerArcWidth,
      vectorEffect: 'non-scaling-stroke',
    })
    children.push({
      kind: 'path',
      d: buildSvgArcPath(stairCenter, innerRadius, visualSectorStartAngle, visualSectorEndAngle),
      fill: 'none',
      stroke: stairStroke,
      strokeWidth: innerArcWidth,
      vectorEffect: 'non-scaling-stroke',
    })

    // 3. Step lines (radial spokes).
    const { stepCount, stepSweep } = layout
    const breakStep = stairPlanBreakStep(stepCount)
    for (let index = 0; index <= stepCount; index += 1) {
      if (index >= breakStep && index !== stepCount) continue
      const angle = sectorStartAngle + stepSweep * index
      const inner = getArcPlanPoint(stairCenter, innerRadius, angle)
      const outer = getArcPlanPoint(stairCenter, outerRadius, angle)
      const isLast = index === stepCount
      const isFirst = index === 0
      // Curved stairs accent both ascent portals.
      // Spiral: only the last step is accented + bolded.
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
    const direction = resolveStairPlanDirection(
      stair,
      ctx.parent?.type === 'level' ? ctx.parent.id : stair.parentId,
    )
    const arrowAngle =
      direction === 'up'
        ? sectorEndAngle + layout.landingSweep - stepSweep * 0.8
        : sectorStartAngle + stepSweep * 0.8
    const arrowPoint = getArcPlanPoint(stairCenter, centerlineRadius, arrowAngle)
    const sweepDirection = normalizedSweepAngle >= 0 ? 1 : -1
    const tangentAngle =
      arrowAngle + sweepDirection * (direction === 'up' ? Math.PI / 2 : -Math.PI / 2)
    const arrowSize = clamp(layout.width * (stairType === 'spiral' ? 0.18 : 0.16), 0.1, 0.18)
    const headPts = buildSvgArrowHeadPoints(arrowPoint, tangentAngle, arrowSize)
    children.push({
      kind: 'polygon',
      points: headPts.map((p) => [p.x, p.y] as FloorplanPoint),
      fill: stairAccent,
      stroke: 'none',
      metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
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
    const direction = resolveStairPlanDirection(
      stair,
      ctx.parent?.type === 'level' ? ctx.parent.id : stair.parentId,
    )
    const directionArrow = resolveStraightStairDirectionArrow(entry, direction)
    if (directionArrow && directionArrow.polyline.length >= 2) {
      children.push({
        kind: 'polyline',
        points: toFloorplanPoints(directionArrow.polyline),
        fill: 'none',
        stroke: stairAccent,
        strokeWidth: 0.02,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        opacity: showSelectedChrome ? 0.92 : 0.72,
        metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
      })
    }
    if (directionArrow && directionArrow.head.length >= 3) {
      children.push({
        kind: 'polygon',
        points: toFloorplanPoints(directionArrow.head),
        fill: stairAccent,
        stroke: 'none',
        opacity: showSelectedChrome ? 0.92 : 0.72,
        metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
      })
    }
  }

  if (isSelected) {
    const chain = (ctx.children ?? []).filter(
      (child): child is StairSegmentNode => child.type === 'stair-segment',
    )
    for (const path of resolveStairWalkingPaths(stair, chain, 0)) {
      children.push({
        kind: 'polyline',
        points: path.map(([x, , z]) => [
          stair.position[0] + x * Math.cos(stair.rotation) + z * Math.sin(stair.rotation),
          stair.position[2] - x * Math.sin(stair.rotation) + z * Math.cos(stair.rotation),
        ]),
        fill: 'none',
        stroke: '#2563eb',
        strokeWidth: 0.035,
        strokeDasharray: '0.12 0.08',
        metadata: floorplanGeometryMetadata({
          annotationRole: 'stair-annotation',
          renderPass: 'overlay',
        }),
      })
    }
  }

  const railNodes = Object.fromEntries([stair, ...ctx.children].map((node) => [node.id, node]))
  const guardPaths =
    stair.railingPath === 'continuous' ||
    stair.railingStyle === 'glass' ||
    stair.railingStyle === 'metal'
      ? resolveStairRailPaths(stair, railNodes)
      : []
  for (const path of [...guardPaths, ...resolveStairHandrailPaths(stair, railNodes)])
    children.push({
      kind: 'polyline',
      points: path.points.map(([x, , z]) => [
        stair.position[0] + x * Math.cos(stair.rotation) + z * Math.sin(stair.rotation),
        stair.position[2] - x * Math.sin(stair.rotation) + z * Math.cos(stair.rotation),
      ]),
      fill: 'none',
      stroke: stairStroke,
      strokeWidth: 0.02,
      metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
    })
  children.push(...buildStairDocumentation(stair, entry, ctx))

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
      const stairWidth = Math.max(stair.width ?? 1, 0.001)
      localX = stairWidth / 2 + STAIR_ROTATE_PLAN_OFFSET
      localZ = -STAIR_ROTATE_PLAN_OFFSET
    } else {
      const isSpiral = stairType === 'spiral'
      const innerR = Math.max(0.001, stair.innerRadius ?? (isSpiral ? 0.2 : 0.9))
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
