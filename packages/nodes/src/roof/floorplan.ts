import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getRoofSegmentVisibleTopBounds,
  type RoofNode,
  type RoofSegmentNode,
  roofOverlapEntryOwns,
  subtractPolygonsFromPolygon,
  unionPolygons,
} from '@pascal-app/core'
import { getRoofSegmentPlanLinework } from '../roof-segment/floorplan'

type Pt = [number, number]
type Seg = [Pt, Pt]

/** A down-slope arrow: tail at the ridge, head toward the eave, labelled in 12ths. */
type SlopeArrow = { tail: Pt; head: Pt; pitch: string }

type SegPlan = {
  footprint: Pt[]
  /** The visible roof edge — the footprint plus the eave / rake overhang. */
  eave: Pt[]
  ridges: Seg[]
  hips: Seg[]
  breaks: Seg[]
  slopes: SlopeArrow[]
}

type PlanEntry = {
  roof: RoofNode
  segment: RoofSegmentNode
  plan: SegPlan
}

/**
 * `roof-segment.pitch` is stored in DEGREES; a roof plan is annotated as the
 * rise over a 12 run. 30.256° → tan 0.5833 × 12 → 7.00 → '7:12'. Rounded to
 * the nearest half, so a modelled pitch a hair off a standard slope still
 * reads as the slope the framer will cut. Returns '' for a flat roof, which
 * has no slope to annotate.
 */
export function roofPitchLabel(pitchDeg: number): string {
  if (!Number.isFinite(pitchDeg) || pitchDeg <= 0) return ''
  const rise = Math.tan((pitchDeg * Math.PI) / 180) * 12
  if (!Number.isFinite(rise) || rise <= 0) return ''
  const rounded = Math.round(rise * 2) / 2
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}:12`
}

/**
 * One down-slope arrow per roof PLANE, in segment-local coordinates
 * (lx = width axis, lz = depth axis) — the same local space
 * `getRoofSegmentPlanLinework` returns ridges and hips in:
 *
 *   gable / gambrel   two planes falling away from the centre ridge (±lz)
 *   shed              one plane, high eave at −lz falling to +lz
 *   hip / mansard /   four planes, one off each eave
 *     dutch
 *   flat              none
 *
 * Arrows run from just off the ridge to just short of the eave so the head
 * lands inside the roof outline rather than on it.
 */
function slopeArrows(node: RoofSegmentNode): { tail: [number, number]; head: [number, number] }[] {
  const hw = Math.max(node.width, 0.01) / 2
  const hd = Math.max(node.depth, 0.01) / 2
  const along = (run: number) => ({ near: run * 0.14, far: run * 0.86 })
  switch (node.roofType) {
    case 'flat':
      return []
    case 'shed':
      // Unchanged from the linework builder: the 3D shed falls −lz → +lz.
      return [{ tail: [0, -hd * 0.55], head: [0, hd * 0.55] }]
    case 'gable':
    case 'gambrel': {
      const z = along(hd)
      return [
        { tail: [-hw * 0.35, z.near], head: [-hw * 0.35, z.far] },
        { tail: [hw * 0.35, -z.near], head: [hw * 0.35, -z.far] },
      ]
    }
    default: {
      const z = along(hd)
      const x = along(hw)
      return [
        { tail: [0, z.near], head: [0, z.far] },
        { tail: [0, -z.near], head: [0, -z.far] },
        { tail: [x.near, 0], head: [x.far, 0] },
        { tail: [-x.near, 0], head: [-x.far, 0] },
      ]
    }
  }
}

/** A segment's footprint + eave + ridge/hip/break/slope linework, in world plan coords. */
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
  // The drip edge: core's own visible-top bounds, which add the horizontal
  // component of `overhang` (plus half the wall thickness and, on the sloped
  // faces, the shingle projection) to the footprint on each side.
  const edge = getRoofSegmentVisibleTopBounds(seg)
  const pitch = roofPitchLabel(seg.pitch)
  return {
    footprint: [tp(-hw, -hd), tp(hw, -hd), tp(hw, hd), tp(-hw, hd)],
    eave: [
      tp(edge.minX, edge.minZ),
      tp(edge.maxX, edge.minZ),
      tp(edge.maxX, edge.maxZ),
      tp(edge.minX, edge.maxZ),
    ],
    ridges: lw.ridges.map(mapSeg),
    hips: lw.hips.map(mapSeg),
    breaks: lw.breaks.map(mapSeg),
    slopes: slopeArrows(seg).map((arrow) => ({
      tail: tp(arrow.tail[0], arrow.tail[1]),
      head: tp(arrow.head[0], arrow.head[1]),
      pitch,
    })),
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
        return roofOverlapEntryOwns(
          {
            roofId: String(candidate.roof.id),
            segmentId: String(candidate.segment.id),
            width: candidate.segment.width,
            depth: candidate.segment.depth,
          },
          {
            roofId: String(entry.roof.id),
            segmentId: String(entry.segment.id),
            width: entry.segment.width,
            depth: entry.segment.depth,
          },
        )
      })
      .map((candidate) => candidate.plan.footprint)
    return {
      plan: entry.plan,
      cutters,
      footprints: subtractPolygonsFromPolygon(entry.plan.footprint, cutters) as Pt[][],
      eaves: subtractPolygonsFromPolygon(entry.plan.eave, cutters) as Pt[][],
      /** True when the drip edge is far enough outside the wall line to draw. */
      hasOverhang: polygonSpread(entry.plan.eave) - polygonSpread(entry.plan.footprint) > 0.04,
    }
  })
  const rings = unionPolygons(visiblePlans.flatMap(({ footprints }) => footprints)) as Pt[][]
  if (rings.length === 0) return null
  const eaveRings = unionPolygons(
    visiblePlans.flatMap(({ eaves, hasOverhang }) => (hasOverhang ? eaves : [])),
  ) as Pt[][]

  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected ?? false) || (view?.highlighted ?? false)
  const ink = showSelectedChrome && palette ? palette.selectedStroke : '#111111'
  const eaveWidth = showSelectedChrome ? 0.04 : 0.03
  const ridgeWidth = showSelectedChrome ? 0.05 : 0.038
  const hipWidth = showSelectedChrome ? 0.04 : 0.026
  const overhangWidth = showSelectedChrome ? 0.03 : 0.022

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

  // The drip edge — the roof's actual outer boundary, overhang included —
  // drawn DASHED under the wall line so the two never read as one edge. This
  // is the convention every roof plan uses: solid where the roof meets the
  // structure, dashed where it flies past it.
  for (const ring of eaveRings) {
    if (ring.length < 3) continue
    children.push({
      kind: 'polygon',
      points: ring.map(([x, z]) => [x, z] as FloorplanPoint),
      fill: 'none',
      stroke: ink,
      strokeWidth: overhangWidth,
      strokeDasharray: '0.28 0.16',
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    })
  }

  // Merged outline (wall line under the roof).
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

    // One down-slope arrow per roof plane, each tagged with the pitch in
    // 12ths — the annotation a roof plan is read for. The arrow points the
    // way water runs; the tag is the number the framer cuts to.
    for (const slope of plan.slopes) {
      const visibleSlope = clipLineByCutters([slope.tail, slope.head], cutters).at(-1)
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
      if (!slope.pitch || len < PITCH_LABEL_MIN_RUN) continue
      // Set beside the shaft, clear of it, at the arrow's midpoint. The
      // perpendicular is chosen so the tag always sits ABOVE its arrow (and
      // to its right where the arrow runs vertically), so opposing slopes of
      // the same roof do not put their tags on opposite sides.
      let px = uz
      let pz = -ux
      if (pz > 1e-6 || (Math.abs(pz) <= 1e-6 && px < 0)) {
        px = -px
        pz = -pz
      }
      const mx = (visibleTail[0] + visibleHead[0]) / 2 + px * PITCH_LABEL_OFFSET
      const mz = (visibleTail[1] + visibleHead[1]) / 2 + pz * PITCH_LABEL_OFFSET
      children.push({
        kind: 'text',
        x: mx,
        y: mz,
        text: slope.pitch,
        fontSize: PITCH_LABEL_FONT_SIZE,
        fill: ink,
        stroke: '#ffffff',
        strokeWidth: PITCH_LABEL_FONT_SIZE * 0.3,
        paintOrder: 'stroke',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 600,
        textAnchor: 'middle',
        dominantBaseline: 'central',
        upright: true,
        metadata: { annotationRole: 'roof-pitch' },
      })
    }
  }

  return children.length > 0 ? { kind: 'group', children } : null
}

/** Longest edge of a polygon's bounding box — how the overhang test compares. */
function polygonSpread(polygon: Pt[]): number {
  if (polygon.length === 0) return 0
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  return Math.max(...xs) - Math.min(...xs) + (Math.max(...zs) - Math.min(...zs))
}

const PITCH_LABEL_FONT_SIZE = 0.22
const PITCH_LABEL_OFFSET = 0.24
/** Below this arrow length the tag would sit on top of its own arrowhead. */
const PITCH_LABEL_MIN_RUN = 0.6
