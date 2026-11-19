import { nodeRegistry } from '../registry/registry'
import type { AnyNode } from '../schema'
import type { RoofNode } from '../schema/nodes/roof'
import {
  getBarrelRoofFaces,
  getGlazedRoofFaces,
  isGlazedRoofSegment,
  isIndependentRoofSegment,
} from '../schema/nodes/roof-glazing'
import {
  getConicalRoofCoverage,
  getSegmentSlopeFrame,
  hasSegmentMaterialOverride,
  isBandedShedSegment,
  type RoofSegmentNode,
} from '../schema/nodes/roof-segment'
import { getRoofModuleFaces, getRoofShapeRatios } from '../schema/nodes/roof-segment-shape'
import { triangulatePlanPolygon } from './earcut'
import { roofSegmentFrame } from './roof-frame'
import { clipRoofTrianglesByTrim, getRoofSegmentTrimCuts } from './roof-outline'
import { roofOverlapEntryOwns } from './roof-overlap'
import { getShedFootprintPieces } from './roof-shed-pieces'
import {
  buildRoofSegmentCoveringTriangles,
  buildRoofSegmentShellTriangles,
  faceTriangles,
  getRoofSegmentShellPatches,
  getRoofShingleModules,
  type RoofSurfacePatch,
  type RoofSurfaceTriangle,
} from './roof-surface-geometry'

type Vec3 = [number, number, number]
type PlanPoint = readonly [number, number]
type Scene = Readonly<Record<string, AnyNode>>
type PlaneTest = (point: Vec3) => number
const BOUNDARY = 1e-9
const COPLANAR = 1e-7

export type RoofSurfaceResult<T> =
  | { status: 'supported'; value: T }
  | { status: 'miss'; reason: 'outside-surface' | 'invalid-host' | 'invalid-query' }
  | {
      status: 'unmeasured'
      reason: 'accessory-cut' | 'plugin-cut' | 'roof-intersection'
      nodeIds: string[]
    }
export type RoofSurfaceSeat = {
  segment: RoofSegmentNode
  position: Vec3
  normal: Vec3
  triangle: RoofSurfaceTriangle
}
export type RoofShellSupport = {
  segment: RoofSegmentNode
  outline: [number, number][]
  triangles: RoofSurfaceTriangle[]
  plane: Vec3 | null
  normal: Vec3 | null
  patches: RoofSurfacePatch[]
}
type Blocker = Extract<RoofSurfaceResult<never>, { status: 'unmeasured' }>
const miss = (reason: Extract<RoofSurfaceResult<never>, { status: 'miss' }>['reason']) =>
  ({ status: 'miss', reason }) as const
const blocked = (reason: Blocker['reason'], id: string): Blocker => ({
  status: 'unmeasured',
  reason,
  nodeIds: [id],
})
const finitePoint = (point: PlanPoint) =>
  Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const difference = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const plan = (p: Vec3): [number, number] => [p[0], p[2]]
const cross2 = (a: PlanPoint, b: PlanPoint, c: PlanPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function validRoof(roof: RoofNode, nodes: Scene): boolean {
  return (
    roof?.type === 'roof' && nodes?.[roof.id]?.type === 'roof' && nodes[roof.id]?.id === roof.id
  )
}
function validHost(roof: RoofNode, segment: RoofSegmentNode, nodes: Scene): boolean {
  if (!validRoof(roof, nodes) || segment?.type !== 'roof-segment') return false
  const stored = nodes[segment.id]
  const storedRoof = nodes[roof.id] as RoofNode
  return (
    stored?.type === 'roof-segment' &&
    stored.id === segment.id &&
    stored.parentId === roof.id &&
    segment.parentId === roof.id &&
    roof.children.includes(segment.id) &&
    storedRoof.children.includes(segment.id)
  )
}

function planeOf(triangle: RoofSurfaceTriangle): Vec3 {
  const [nx, ny, nz] = triangle.normal
  const a = -nx / ny || 0
  const b = -nz / ny || 0
  const p = triangle.vertices[0]
  return [a, b, p[1] - a * p[0] - b * p[2]]
}
function height(triangle: RoofSurfaceTriangle, point: PlanPoint): number {
  const [a, b, c] = planeOf(triangle)
  return a * point[0] + b * point[1] + c
}
function planPlanes(vertices: readonly Vec3[]): PlaneTest[] {
  const origin = vertices[0]
  if (!origin) return [() => -1]
  // Translate before computing area: a near-vertical face must never turn into
  // unconstrained half-planes through cancellation of large absolute coordinates.
  const area = vertices
    .slice(1, -1)
    .reduce((sum, a, i) => sum + cross2(plan(origin), plan(a), plan(vertices[i + 2]!)), 0)
  if (!Number.isFinite(area) || area === 0) return [() => -1]
  const sign = Math.sign(area)
  return vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length]!
    const length = Math.hypot(b[0] - a[0], b[2] - a[2])
    return (p: Vec3) => (length ? (sign * cross2(plan(a), plan(b), plan(p))) / length : 0)
  })
}
function seatAt(
  segment: RoofSegmentNode,
  triangles: readonly RoofSurfaceTriangle[],
  point: PlanPoint,
): RoofSurfaceSeat | undefined {
  let best: RoofSurfaceSeat | undefined
  for (const triangle of triangles) {
    const [a, b, c] = triangle.vertices
    const denominator = cross2(plan(a), plan(b), plan(c))
    if (!Number.isFinite(denominator) || denominator === 0) continue
    const wa = cross2(point, plan(b), plan(c)) / denominator
    const wb = cross2(plan(a), point, plan(c)) / denominator
    const wc = 1 - wa - wb
    const span = Math.max(
      Math.hypot(a[0] - b[0], a[2] - b[2]),
      Math.hypot(a[0] - c[0], a[2] - c[2]),
      Math.hypot(b[0] - c[0], b[2] - c[2]),
    )
    const allowance = BOUNDARY / span
    if (
      ![wa, wb, wc].every(
        (weight) => Number.isFinite(weight) && weight >= -allowance && weight <= 1 + allowance,
      )
    )
      continue
    // Barycentric interpolation remains bounded by the backing triangle; solving
    // an almost vertical plane for Y can amplify roundoff into invented heights.
    const y = wa * a[1] + wb * b[1] + wc * c[1]
    if (Number.isFinite(y) && (!best || y > best.position[1]))
      best = { segment, position: [point[0], y, point[1]], normal: triangle.normal, triangle }
  }
  return best
}

/** Clip in 3D so the retained polygon stays on the original physical plane. */
function clip(polygon: readonly Vec3[], signed: PlaneTest, inside = true): Vec3[] {
  const result: Vec3[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const da = signed(a)
    const db = signed(b)
    const keepA = inside ? da >= 0 : da < 0
    const keepB = inside ? db >= 0 : db < 0
    if (keepA) result.push(a)
    if (keepA !== keepB) {
      const t = da / (da - db)
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])])
    }
  }
  return result
}
function intersect(polygon: readonly Vec3[], planes: readonly PlaneTest[]): Vec3[] {
  return planes.reduce<Vec3[]>((part, signed) => clip(part, signed), [...polygon])
}
function hasArea(polygon: readonly Vec3[]): boolean {
  if (polygon.length < 3) return false
  let longest = 0
  let edge = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const length = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (length > longest) {
      longest = length
      edge = i
    }
  }
  if (longest <= BOUNDARY) return false
  const a = plan(polygon[edge]!)
  const b = plan(polygon[(edge + 1) % polygon.length]!)
  return polygon.some((p) => Math.abs(cross2(a, b, plan(p))) / longest > BOUNDARY)
}
function subtract(polygon: readonly Vec3[], planes: readonly PlaneTest[]): Vec3[][] {
  let remaining = [...polygon]
  const outside: Vec3[][] = []
  for (const signed of planes) {
    const part = clip(remaining, signed, false)
    if (hasArea(part)) outside.push(part)
    remaining = clip(remaining, signed)
    if (!hasArea(remaining)) break
  }
  return outside
}
function fan(polygon: readonly Vec3[], normal: Vec3): RoofSurfaceTriangle[] {
  return polygon.slice(1, -1).flatMap((b, i) => {
    const vertices: [Vec3, Vec3, Vec3] = [polygon[0]!, b, polygon[i + 2]!]
    if (!hasArea(vertices)) return []
    if (cross2(plan(vertices[0]), plan(b), plan(vertices[2])) > 0) vertices.reverse()
    return [{ vertices, normal }]
  })
}
function validOutline(points: readonly PlanPoint[]): boolean {
  if (!Array.isArray(points) || points.length < 3 || !points.every(finitePoint)) return false
  const on = (a: PlanPoint, b: PlanPoint, p: PlanPoint) =>
    Math.abs(cross2(a, b, p)) <= BOUNDARY * Math.hypot(b[0] - a[0], b[1] - a[1]) &&
    p[0] >= Math.min(a[0], b[0]) - BOUNDARY &&
    p[0] <= Math.max(a[0], b[0]) + BOUNDARY &&
    p[1] >= Math.min(a[1], b[1]) - BOUNDARY &&
    p[1] <= Math.max(a[1], b[1]) + BOUNDARY
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= BOUNDARY) return false
    const next = points[(i + 2) % points.length]!
    if (on(a, b, next)) return false
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
      const c = points[j]!
      const d = points[(j + 1) % points.length]!
      if (
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b) ||
        (cross2(a, b, c) * cross2(a, b, d) < 0 && cross2(c, d, a) * cross2(c, d, b) < 0)
      )
        return false
    }
  }
  return hasArea(points.map(([x, z]) => [x, 0, z]))
}

/** Native skylight placement frame, NOT the strict physical seating reader. */
function skylightFrame(
  segment: RoofSegmentNode,
  point: PlanPoint,
): { position: Vec3; normal: Vec3 } {
  const [x, z] = point
  if (isGlazedRoofSegment(segment) || segment.roofType === 'barrel') {
    const faces = isGlazedRoofSegment(segment)
      ? getGlazedRoofFaces(segment)
      : getBarrelRoofFaces(segment)
    const face = faces.find(
      (face) =>
        face.normal[1] > 0 &&
        x >= face.origin[0] &&
        x <= face.origin[0] + face.width &&
        (z - face.origin[2]) / face.v[2] >= -1e-6 &&
        (z - face.origin[2]) / face.v[2] <= face.length + 1e-6,
    )
    if (face)
      return {
        position: [x, face.origin[1] + (face.v[1] * (z - face.origin[2])) / face.v[2], z],
        normal: [...face.normal],
      }
  }
  const { activeRh, sinTheta, cosTheta } = getSegmentSlopeFrame(segment)
  if (segment.roofType === 'flat' || activeRh === 0)
    return {
      position: [x, segment.wallHeight + segment.deckThickness + segment.shingleThickness, z],
      normal: [0, 1, 0],
    }
  // This legacy native cutter recipe differs from the shingle brush's top recipe.
  const { bottom } = getRoofShingleModules(segment)
  const lip = segment.shingleThickness * sinTheta
  const inset = Math.max(0.01, Math.min(segment.width, segment.depth) * 0.25)
  const all = ['hip', 'conical', 'mansard', 'dutch'].includes(segment.roofType)
  const gable = ['gable', 'gambrel'].includes(segment.roofType)
  let faces = getRoofModuleFaces({
    ...bottom,
    w: bottom.w + 2 * lip,
    d: bottom.d + 2 * lip,
    wh: bottom.wh + segment.shingleThickness * cosTheta,
    rh: bottom.rh + segment.shingleThickness * cosTheta,
    baseY: 0,
    insets: {
      iL: all || gable ? inset : 0,
      iR: all || gable ? inset : 0,
      iF: all || segment.roofType === 'shed' ? inset : 0,
      iB: all ? inset : 0,
      dutchI: Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio,
    },
    // The legacy frame's module has no conical/barrel roof branch after its face lookup.
    type:
      segment.roofType === 'conical' || segment.roofType === 'barrel' ? 'gable' : segment.roofType,
  })
  if (segment.roofType === 'conical' || segment.roofType === 'barrel') faces = faces.slice(0, 5)
  const shift = all ? 0 : lip
  // Native raycasting reads the Float32 geometry, from both sides, after its translation.
  faces = faces.map((face) =>
    face.map((p) => ({
      x: Math.fround(p.x),
      y: Math.fround(p.y),
      z: Math.fround(Math.fround(p.z) + shift),
    })),
  )
  const originY =
    segment.wallHeight + activeRh + segment.deckThickness + segment.shingleThickness + 10
  const hit = seatAt(
    segment,
    faceTriangles(faces, 0, true).filter((t) => height(t, point) <= originY),
    point,
  )
  return hit ?? { position: [x, segment.wallHeight, z], normal: [0, 1, 0] }
}
function boxPlanes(center: Vec3, axes: [Vec3, Vec3, Vec3], half: Vec3): PlaneTest[] {
  return axes.flatMap((axis, index) =>
    [-1, 1].map((sign) => (p: Vec3) => half[index]! - sign * dot(axis, difference(p, center))),
  )
}
function nativeCutPlanes(child: AnyNode, segment: RoofSegmentNode): PlaneTest[] | null {
  if (child.type === 'dormer') {
    const { width, depth, height: wallHeight, roofHeight, position, rotation } = child
    if (
      ![width, depth, wallHeight, roofHeight, child.wallSkirtHeight, ...position, rotation].every(
        Number.isFinite,
      ) ||
      width < 0.01 ||
      depth < 0.01
    )
      return []
    const low = position[1] - Math.max(0.05, child.wallSkirtHeight)
    const high =
      position[1] +
      Math.max(0.05, wallHeight) +
      (child.roofType === 'flat' ? 0 : Math.max(0, roofHeight))
    const cutYaw =
      rotation + (child.roofType === 'shed' && child.shedHighSide === 'front' ? Math.PI : 0)
    const yaw = Math.abs(cutYaw) > 1e-4 ? cutYaw : 0
    return boxPlanes(
      [position[0], (low + high) / 2, position[2]],
      [
        [Math.cos(yaw), 0, -Math.sin(yaw)],
        [0, 1, 0],
        [Math.sin(yaw), 0, Math.cos(yaw)],
      ],
      [Math.max(0.05, width - 0.1) / 2, (high - low) / 2, Math.max(0.05, depth - 0.1) / 2],
    )
  }
  if (child.type !== 'skylight') return null
  if (
    ![
      ...child.position,
      child.rotation,
      child.width,
      child.height,
      child.frameThickness,
      child.cutoutOffset ?? 0.01,
    ].every(Number.isFinite)
  )
    return null
  const frame = skylightFrame(segment, [child.position[0], child.position[2]])
  const normal = frame.normal
  let right: Vec3 = [1, 0, 0]
  let forward: Vec3 = [0, 0, 1]
  if (normal[1] < 0.9999) {
    const length = Math.hypot(normal[0], normal[2])
    right = length * length < 1e-6 ? right : [normal[2] / length, 0, -normal[0] / length]
    forward = [
      right[1] * normal[2] - right[2] * normal[1],
      right[2] * normal[0] - right[0] * normal[2],
      right[0] * normal[1] - right[1] * normal[0],
    ]
  }
  const yaw = Math.abs(child.rotation) > 1e-4 ? child.rotation : 0
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const xAxis = right.map((v, i) => c * v - s * forward[i]!) as Vec3
  const zAxis = right.map((v, i) => s * v + c * forward[i]!) as Vec3
  const inflate = Math.max(0, child.cutoutOffset ?? 0.01)
  return boxPlanes(
    frame.position,
    [xAxis, normal[1] < 0.9999 ? normal : [0, 1, 0], zAxis],
    [
      Math.max(0.05, child.width + 2 * child.frameThickness + 2 * inflate) / 2,
      1,
      Math.max(0.05, child.height + 2 * child.frameThickness + 2 * inflate) / 2,
    ],
  )
}
function receivesAccessoryCuts(segment: RoofSegmentNode): boolean {
  if (isGlazedRoofSegment(segment) || segment.roofType === 'barrel') return true
  if (
    segment.roofType === 'shed' &&
    (isBandedShedSegment(segment) || getShedFootprintPieces(segment).length)
  )
    return false
  return !(
    segment.roofType === 'conical' &&
    !getConicalRoofCoverage(segment).fullCircle &&
    !getRoofSegmentTrimCuts(segment).length
  )
}
function accessoryGuard(
  segment: RoofSegmentNode,
  polygons: readonly Vec3[][],
  nodes: Scene,
): Blocker | undefined {
  if (!receivesAccessoryCuts(segment)) return
  for (const id of segment.children) {
    const child = nodes[id]
    if (!child || child.metadata?.isTransient || child.type === 'chimney') continue
    const capability = nodeRegistry.get(child.type)?.capabilities?.roofAccessory
    if (capability?.cutScope === 'wall') continue
    if (child.type === 'dormer' || child.type === 'skylight') {
      let planes: PlaneTest[] | null
      try {
        planes = nativeCutPlanes(child, segment)
      } catch {
        // Malformed persisted cut data is not evidence that a native cut is absent.
        return blocked('accessory-cut', child.id)
      }
      if (!planes) return blocked('accessory-cut', child.id)
      if (!planes.length) continue
      if (
        polygons.some((polygon) =>
          polygon.length === 1
            ? planes.every((signed) => signed(polygon[0]!) >= -BOUNDARY)
            : hasArea(intersect(polygon, planes)),
        )
      )
        return blocked('accessory-cut', child.id)
    } else if (capability?.buildCut) return blocked('plugin-cut', child.id)
  }
}

function overlapEntry(roof: RoofNode, segment: RoofSegmentNode, nodes: Scene) {
  const support = roof.support?.kind === 'roof' ? nodes[roof.support.roofSegmentId] : undefined
  return {
    roofId: roof.id,
    segmentId: segment.id,
    roofType: segment.roofType,
    width: segment.width,
    depth: segment.depth,
    supportRoofId: support?.type === 'roof-segment' ? (support.parentId ?? undefined) : undefined,
    supportRoofSegmentId: roof.support?.kind === 'roof' ? roof.support.roofSegmentId : undefined,
  }
}
function siblingEntries(
  roof: RoofNode,
  nodes: Scene,
): { roof: RoofNode; segment: RoofSegmentNode }[] {
  const parent = roof.parentId ? nodes[roof.parentId] : undefined
  const ids =
    parent && 'children' in parent && Array.isArray(parent.children)
      ? parent.children.filter((id) => nodes[id]?.type === 'roof')
      : [roof.id]
  if (!ids.includes(roof.id)) ids.push(roof.id)
  return ids.flatMap((id) => {
    const owner = nodes[id]
    if (owner?.type !== 'roof') return []
    return owner.children.flatMap((id) => {
      const child = nodes[id]
      // Native cutter dispatch follows these references, not the child's parent field.
      // Requested hosts and picker candidates still require reciprocal membership.
      return child?.type === 'roof-segment' ? [{ roof: owner, segment: child }] : []
    })
  })
}
/** Only the native interior cutter's upper boundary, for conservative scene guarding. */
function interiorTop(segment: RoofSegmentNode): RoofSurfaceTriangle[] {
  const { activeRh, tanTheta } = getSegmentSlopeFrame(segment)
  const drop = (-segment.wallThickness / 2) * tanTheta
  const coverage = getConicalRoofCoverage(segment)
  const w = Math.max(0.01, segment.width - segment.wallThickness)
  const d = Math.max(0.01, segment.depth - segment.wallThickness)
  const faces = getRoofModuleFaces({
    type: segment.roofType,
    w,
    d,
    wh: Math.max(0.05, segment.wallHeight - drop),
    rh: activeRh > 0 ? activeRh + drop : 0,
    baseY: -5,
    insets: { dutchI: Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio },
    baseW: segment.width,
    baseD: segment.depth,
    tanTheta,
    shapeRatios: getRoofShapeRatios(segment),
    dutchTopRakeThickness: segment.dutchTopRakeThickness,
    conicalStartAngle: coverage.startAngle,
    conicalSweepAngle: coverage.sweepAngle,
  })
  // Expanded sibling-local coordinates, where native trim CSG takes place.
  // roofGuard preserves the retained Brush.scale when accounting for placement.
  return faceTriangles(
    faces.map((face) =>
      face.map((p) => ({
        x: Math.fround(p.x) * (1 + 0.002 / w),
        y: Math.fround(p.y),
        z: Math.fround(p.z) * (1 + 0.002 / d),
      })),
    ),
  )
}
function outsideTrim(point: Vec3, segment: RoofSegmentNode): boolean {
  return getRoofSegmentTrimCuts(segment).every(
    ({ center, size, rotation }) =>
      !boxPlanes(
        center,
        [
          [Math.cos(rotation), 0, -Math.sin(rotation)],
          [0, 1, 0],
          [Math.sin(rotation), 0, Math.cos(rotation)],
        ],
        size.map((v) => v / 2) as Vec3,
      ).every((signed) => signed(point) >= 0),
  )
}
function roofGuard(
  roof: RoofNode,
  segment: RoofSegmentNode,
  polygons: readonly Vec3[][],
  nodes: Scene,
  covering: boolean,
): Blocker | undefined {
  const frame = roofSegmentFrame(roof, segment)
  const csgFrame =
    isIndependentRoofSegment(segment) || hasSegmentMaterialOverride(segment)
      ? frame
      : roofSegmentFrame(roof, { position: [0, 0, 0], rotation: 0 })
  for (const entry of siblingEntries(roof, nodes)) {
    const other = entry.segment
    if (other.id === segment.id) continue
    const targetFrame = roofSegmentFrame(entry.roof, other)
    const local = polygons.map((polygon) =>
      polygon.map((p) => targetFrame.levelToLocal(frame.localToLevel(p))),
    )
    if (covering) {
      const tops = buildRoofSegmentCoveringTriangles(entry.roof, other, nodes)
      for (const polygon of local)
        for (const top of tops) {
          const planes = [
            ...planPlanes(top.vertices),
            (p: Vec3) => height(top, plan(p)) - p[1] - BOUNDARY,
          ]
          if (
            polygon.length === 1
              ? planes.every((signed) => signed(polygon[0]!) >= 0)
              : hasArea(intersect(polygon, planes))
          )
            return blocked('roof-intersection', other.id)
        }
    }
    if (
      other.roofType === 'shed' ||
      !roofOverlapEntryOwns(
        overlapEntry(entry.roof, other, nodes),
        overlapEntry(roof, segment, nodes),
      )
    )
      continue
    const tops = interiorTop(other)
    const sx = 1 + 0.002 / Math.max(0.01, other.width - other.wallThickness)
    const sz = 1 + 0.002 / Math.max(0.01, other.depth - other.wallThickness)
    const cutterLocal = polygons.map((polygon) =>
      polygon.map((p): Vec3 => {
        // Native applies relative placement to geometry, then the retained brush
        // scale in roof space (merged) or segment space (independent/overridden).
        // Undo that scale BEFORE inverse placement. Finally reapply it in sibling
        // coordinates, matching interiorTop and the trims used to build the cutter.
        const placed = csgFrame.levelToLocal(frame.localToLevel(p))
        const unscaled: Vec3 = [placed[0] / sx, placed[1], placed[2] / sz]
        const sibling = targetFrame.levelToLocal(csgFrame.localToLevel(unscaled))
        return [sibling[0] * sx, sibling[1], sibling[2] * sz]
      }),
    )
    for (const polygon of cutterLocal) {
      const parts =
        polygon.length === 1
          ? outsideTrim(polygon[0]!, other)
            ? [polygon]
            : []
          : clipRoofTrianglesByTrim(other, fan(polygon, [0, 1, 0])).map((t) => t.vertices)
      for (const part of parts)
        for (const top of tops) {
          const planes = [
            ...planPlanes(top.vertices),
            (p: Vec3) => p[1] + 5,
            (p: Vec3) => height(top, plan(p)) - p[1],
          ]
          if (
            part.length === 1
              ? planes.every((signed) => signed(part[0]!) >= -BOUNDARY)
              : hasArea(intersect(part, planes))
          )
            return blocked('roof-intersection', other.id)
        }
    }
  }
}
function guard(
  roof: RoofNode,
  segment: RoofSegmentNode,
  polygons: readonly Vec3[][],
  nodes: Scene,
  covering: boolean,
): Blocker | undefined {
  return (
    accessoryGuard(segment, polygons, nodes) ?? roofGuard(roof, segment, polygons, nodes, covering)
  )
}
function readSeat(
  roof: RoofNode,
  segment: RoofSegmentNode,
  point: PlanPoint,
  nodes: Scene,
  covering: boolean,
): RoofSurfaceResult<RoofSurfaceSeat> {
  if (!finitePoint(point)) return miss('invalid-query')
  if (!validHost(roof, segment, nodes)) return miss('invalid-host')
  const triangles = (covering ? buildRoofSegmentCoveringTriangles : buildRoofSegmentShellTriangles)(
    roof,
    segment,
    nodes,
  )
  const seat = seatAt(segment, triangles, point)
  if (!seat) return miss('outside-surface')
  return (
    guard(roof, segment, [[seat.position]], nodes, covering) ?? { status: 'supported', value: seat }
  )
}

/** Absence here is local host absence, never a global exposure/clearance certificate. */
export function getRoofSegmentCoveringSeat(
  roof: RoofNode,
  segment: RoofSegmentNode,
  point: PlanPoint,
  nodes: Scene,
): RoofSurfaceResult<RoofSurfaceSeat> {
  return readSeat(roof, segment, point, nodes, true)
}
export function getRoofSegmentShellSeat(
  roof: RoofNode,
  segment: RoofSegmentNode,
  point: PlanPoint,
  nodes: Scene,
): RoofSurfaceResult<RoofSurfaceSeat> {
  return readSeat(roof, segment, point, nodes, false)
}
export function pickRoofCoveringSeat(
  roof: RoofNode,
  point: PlanPoint,
  nodes: Scene,
): RoofSurfaceResult<RoofSurfaceSeat> {
  if (!finitePoint(point)) return miss('invalid-query')
  if (!validRoof(roof, nodes)) return miss('invalid-host')
  const candidates = roof.children
    .flatMap((id, order) => {
      const segment = nodes[id]
      if (segment?.type !== 'roof-segment' || !validHost(roof, segment, nodes)) return []
      const frame = roofSegmentFrame(roof, segment)
      const seat = seatAt(
        segment,
        buildRoofSegmentCoveringTriangles(roof, segment, nodes),
        frame.toLocal(point),
      )
      return seat ? [{ seat, y: frame.localToLevel(seat.position)[1], order }] : []
    })
    .sort((a, b) => b.y - a.y || a.order - b.order)
  // Cuts can only lower the uncut upper bound. Thus a lower uncertain candidate cannot
  // outrank this winner, but an uncertain winner must not be silently bypassed.
  const winner = candidates[0]?.seat
  if (!winner) return miss('outside-surface')
  return (
    guard(roof, winner.segment, [[winner.position]], nodes, true) ?? {
      status: 'supported',
      value: winner,
    }
  )
}

export function getRoofSegmentShellSupport(
  roof: RoofNode,
  segment: RoofSegmentNode,
  footprint: readonly PlanPoint[],
  nodes: Scene,
): RoofSurfaceResult<RoofShellSupport> {
  if (!validOutline(footprint)) return miss('invalid-query')
  if (!validHost(roof, segment, nodes)) return miss('invalid-host')
  const outline: [number, number][] = footprint.map(([x, z]) => [x, z])
  const requests = triangulatePlanPolygon(outline).map((indices) =>
    indices.map((i): Vec3 => [outline[i]![0], 0, outline[i]![1]]),
  )
  if (!requests.length) return miss('invalid-query')
  const sources = getRoofSegmentShellPatches(roof, segment, nodes).flatMap((patch) =>
    patch.triangles.map((triangle) => ({ patch, triangle })),
  )
  const patches: RoofSurfacePatch[] = []
  for (const request of requests) {
    let uncovered: Vec3[][] = [request]
    for (let i = 0; i < sources.length; i++) {
      const { patch, triangle } = sources[i]!
      let parts = [intersect(triangle.vertices, planPlanes(request))].filter(hasArea)
      // Form an upper envelope before removing overlap. Ordering alone cannot choose
      // between two construction planes that cross inside the requested footprint.
      for (let j = 0; j < sources.length && parts.length; j++) {
        if (i === j) continue
        const other = sources[j]!.triangle
        const domain = planPlanes(other.vertices)
        if (!hasArea(intersect(triangle.vertices, domain))) continue
        const coincident =
          Math.hypot(...difference(triangle.normal, other.normal)) <= 1e-12 &&
          triangle.vertices.every((p) => Math.abs(height(other, plan(p)) - p[1]) <= BOUNDARY)
        const planes = [
          ...domain,
          (p: Vec3) => (coincident ? (j < i ? 1 : -1) : height(other, plan(p)) - p[1]),
        ]
        parts = parts.flatMap((part) => subtract(part, planes))
      }
      for (const part of parts) {
        const triangles = fan(part, triangle.normal)
        if (!triangles.length) continue
        patches.push({ ...patch, triangles })
        uncovered = uncovered.flatMap((polygon) => subtract(polygon, planPlanes(part)))
      }
    }
    if (uncovered.some(hasArea)) return miss('outside-surface')
  }
  const triangles = patches.flatMap((patch) => patch.triangles)
  if (!triangles.length) return miss('outside-surface')
  const blocker = guard(
    roof,
    segment,
    triangles.map((t) => t.vertices),
    nodes,
    false,
  )
  if (blocker) return blocker
  const first = triangles[0]!
  const origin = first.vertices[0]
  const coplanar = triangles.every(
    (triangle) =>
      Math.hypot(...difference(triangle.normal, first.normal)) <= COPLANAR &&
      triangle.vertices.every(
        (p) => Math.abs(dot(first.normal, difference(p, origin))) <= COPLANAR,
      ),
  )
  return {
    status: 'supported',
    value: {
      segment,
      outline,
      triangles,
      patches,
      plane: coplanar ? planeOf(first) : null,
      normal: coplanar ? (first.normal.map((v) => v || 0) as Vec3) : null,
    },
  }
}
