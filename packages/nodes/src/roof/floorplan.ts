import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  type RoofNode,
  type RoofSegmentNode,
  roofPlanOverlapEntryOwns,
  subtractPolygonsFromPolygon,
  unionPolygons,
} from '@pascal-app/core'
import { getConicalRoofPlanFootprint, getRoofSegmentPlanLinework } from '../roof-segment/floorplan'

type Pt = [number, number]
type Seg = [Pt, Pt]

type SegPlan = {
  footprint: Pt[]
  ridges: Seg[]
  hips: Seg[]
  breaks: Seg[]
  slope: { tail: Pt; head: Pt } | null
}

type PlanEntry = {
  roof: RoofNode
  segment: RoofSegmentNode
  plan: SegPlan
}

function overlapEntry(entry: PlanEntry, ctx: GeometryContext) {
  const supportSegment =
    entry.roof.support?.kind === 'roof'
      ? ctx.resolve<RoofSegmentNode>(entry.roof.support.roofSegmentId)
      : undefined
  return {
    roofId: String(entry.roof.id),
    segmentId: String(entry.segment.id),
    supportRoofId:
      supportSegment?.type === 'roof-segment' && supportSegment.parentId
        ? String(supportSegment.parentId)
        : undefined,
    supportRoofSegmentId:
      entry.roof.support?.kind === 'roof' ? String(entry.roof.support.roofSegmentId) : undefined,
    roofType: entry.segment.roofType,
    width: entry.segment.width,
    depth: entry.segment.depth,
  }
}

/** A segment's footprint + ridge/hip/break/slope linework, in world plan coords. */
function buildSegPlan(roof: RoofNode, seg: RoofSegmentNode): SegPlan {
  const cosRoof = Math.cos(-roof.rotation)
  const sinRoof = Math.sin(-roof.rotation)
  const segCx = roof.position[0] + seg.position[0] * cosRoof - seg.position[2] * sinRoof
  const segCz = roof.position[2] + seg.position[0] * sinRoof + seg.position[2] * cosRoof
  const rot = -(roof.rotation + seg.rotation)
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const tp = (lx: number, lz: number): Pt => [
    segCx + lx * cos - lz * sin,
    segCz + lx * sin + lz * cos,
  ]
  const hw = Math.max(seg.width, 0.01) / 2
  const hd = Math.max(seg.depth, 0.01) / 2
  const lw = getRoofSegmentPlanLinework(seg)
  const mapSeg = (s: readonly [readonly [number, number], readonly [number, number]]): Seg => [
    tp(s[0][0], s[0][1]),
    tp(s[1][0], s[1][1]),
  ]
  const footprint =
    seg.roofType === 'conical'
      ? getConicalRoofPlanFootprint(seg).map(([x, z]) => tp(x, z))
      : [tp(-hw, -hd), tp(hw, -hd), tp(hw, hd), tp(-hw, hd)]
  return {
    footprint,
    ridges: lw.ridges.map(mapSeg),
    hips: lw.hips.map(mapSeg),
    breaks: lw.breaks.map(mapSeg),
    slope: lw.slope
      ? {
          tail: tp(lw.slope.tail[0], lw.slope.tail[1]),
          head: tp(lw.slope.head[0], lw.slope.head[1]),
        }
      : null,
  }
}

function pointInPolygon(point: Pt, polygon: Pt[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index]!
    const [px, py] = polygon[previous]!
    if (y > point[1] === py > point[1]) continue
    const crossingX = ((px - x) * (point[1] - y)) / (py - y) + x
    if (point[0] < crossingX) inside = !inside
  }
  return inside
}

function segmentIntersectionParameter(line: Seg, edge: Seg): number | null {
  const lineX = line[1][0] - line[0][0]
  const lineY = line[1][1] - line[0][1]
  const edgeX = edge[1][0] - edge[0][0]
  const edgeY = edge[1][1] - edge[0][1]
  const determinant = lineX * edgeY - lineY * edgeX
  if (Math.abs(determinant) <= 1e-9) return null
  const offsetX = edge[0][0] - line[0][0]
  const offsetY = edge[0][1] - line[0][1]
  const lineT = (offsetX * edgeY - offsetY * edgeX) / determinant
  const edgeT = (offsetX * lineY - offsetY * lineX) / determinant
  return lineT > 1e-9 && lineT < 1 - 1e-9 && edgeT >= -1e-9 && edgeT <= 1 + 1e-9 ? lineT : null
}

function clipLineByCutters(line: Seg, cutters: Pt[][]): Seg[] {
  const parameters = [0, 1]
  for (const cutter of cutters) {
    for (let index = 0; index < cutter.length; index++) {
      const parameter = segmentIntersectionParameter(line, [
        cutter[index]!,
        cutter[(index + 1) % cutter.length]!,
      ])
      if (parameter !== null) parameters.push(parameter)
    }
  }
  parameters.sort((a, b) => a - b)

  const dx = line[1][0] - line[0][0]
  const dy = line[1][1] - line[0][1]
  const result: Seg[] = []
  for (let index = 0; index < parameters.length - 1; index++) {
    const startT = parameters[index]!
    const endT = parameters[index + 1]!
    if (endT - startT <= 1e-9) continue
    const midT = (startT + endT) / 2
    const midpoint: Pt = [line[0][0] + dx * midT, line[0][1] + dy * midT]
    if (cutters.some((cutter) => pointInPolygon(midpoint, cutter))) continue
    result.push([
      [line[0][0] + dx * startT, line[0][1] + dy * startT],
      [line[0][0] + dx * endT, line[0][1] + dy * endT],
    ])
  }
  return result
}

/**
 * Roof-level floor-plan builder. Draws the whole merged-roof plan: the
 * unioned silhouette and every segment's ridge/hip/break linework. The
 * segment builder keeps only its hit-target / selection chrome.
 *
 * Composition uses the floor plan's negated-rotation convention
 * (segment-local → roof-local → plan). `unionPolygons` returns one ring per
 * disjoint group, so non-touching segments each keep their own outline. The
 * group is decorative (`pointerEvents: 'none'`) — clicks fall through to the
 * segment hit-targets.
 */
export function buildRoofFloorplan(node: RoofNode, ctx: GeometryContext): FloorplanGeometry | null {
  const segments = ctx.children.filter((c): c is RoofSegmentNode => c.type === 'roof-segment')
  if (segments.length === 0) return null

  const entries: PlanEntry[] = segments.map((segment) => ({
    roof: node,
    segment,
    plan: buildSegPlan(node, segment),
  }))
  for (const sibling of ctx.siblings) {
    if (sibling.type !== 'roof') continue
    for (const childId of sibling.children ?? []) {
      const segment = ctx.resolve<RoofSegmentNode>(childId)
      if (segment?.type !== 'roof-segment') continue
      entries.push({ roof: sibling, segment, plan: buildSegPlan(sibling, segment) })
    }
  }

  const currentEntries = entries.filter((entry) => entry.roof.id === node.id)
  const visiblePlans = currentEntries.map((entry) => {
    const cutters = entries
      .filter((candidate) => {
        if (candidate.segment.id === entry.segment.id) return false
        if (candidate.segment.roofType === 'shed') return false
        return roofPlanOverlapEntryOwns(overlapEntry(candidate, ctx), overlapEntry(entry, ctx))
      })
      .map((candidate) => candidate.plan.footprint)
    return {
      plan: entry.plan,
      cutters,
      footprints: subtractPolygonsFromPolygon(entry.plan.footprint, cutters) as Pt[][],
    }
  })
  const rings = unionPolygons(visiblePlans.flatMap(({ footprints }) => footprints)) as Pt[][]
  if (rings.length === 0) return null

  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected ?? false) || (view?.highlighted ?? false)
  const ink = showSelectedChrome && palette ? palette.selectedStroke : '#111111'
  const eaveWidth = showSelectedChrome ? 0.04 : 0.03
  const ridgeWidth = showSelectedChrome ? 0.05 : 0.038
  const hipWidth = showSelectedChrome ? 0.04 : 0.026

  const children: FloorplanGeometry[] = []
  const pushLine = (a: Pt, b: Pt, width: number) => {
    children.push({
      kind: 'line',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      stroke: ink,
      strokeWidth: width,
      strokeLinecap: 'round',
      pointerEvents: 'none',
    })
  }

  // Merged outline (eaves).
  for (const ring of rings) {
    if (ring.length < 3) continue
    children.push({
      kind: 'polygon',
      points: ring.map(([x, z]) => [x, z] as FloorplanPoint),
      fill: 'none',
      stroke: ink,
      strokeWidth: eaveWidth,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    })
  }

  for (const { plan, cutters } of visiblePlans) {
    for (const line of plan.breaks) {
      for (const visible of clipLineByCutters(line, cutters)) {
        pushLine(visible[0], visible[1], hipWidth)
      }
    }
    for (const line of plan.hips) {
      for (const visible of clipLineByCutters(line, cutters)) {
        pushLine(visible[0], visible[1], hipWidth)
      }
    }
    for (const line of plan.ridges) {
      for (const visible of clipLineByCutters(line, cutters)) {
        pushLine(visible[0], visible[1], ridgeWidth)
      }
    }

    if (plan.slope) {
      const { tail, head } = plan.slope
      const visibleSlope = clipLineByCutters([tail, head], cutters).at(-1)
      if (!visibleSlope) continue
      const [visibleTail, visibleHead] = visibleSlope
      const dx = visibleHead[0] - visibleTail[0]
      const dz = visibleHead[1] - visibleTail[1]
      const len = Math.hypot(dx, dz) || 1
      const ux = dx / len
      const uz = dz / len
      const headLen = Math.min(0.22, len * 0.4)
      const wing = headLen * 0.6
      pushLine(visibleTail, visibleHead, hipWidth)
      children.push({
        kind: 'polyline',
        points: [
          [visibleHead[0] - headLen * ux - wing * uz, visibleHead[1] - headLen * uz + wing * ux],
          [visibleHead[0], visibleHead[1]],
          [visibleHead[0] - headLen * ux + wing * uz, visibleHead[1] - headLen * uz - wing * ux],
        ],
        stroke: ink,
        strokeWidth: hipWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        pointerEvents: 'none',
      })
    }
  }

  return children.length > 0 ? { kind: 'group', children } : null
}
