import { queryNodes } from '../runtime/node-queries'
import { generateId } from '../schema/base'
import {
  createDormerDefaultWindow,
  DormerNode,
  getDormerWallOpeningVerticalBounds,
  getDormerWindowExposure,
} from '../schema/nodes/dormer'
import type { RoofSegmentNode } from '../schema/nodes/roof-segment'
import type { WindowNode } from '../schema/nodes/window'
import {
  type DormerScene,
  type DormerWindowExposure,
  dormerRoofHost,
  withoutDormerCut,
} from './dormer-roof-context'
import { segmentsIntersect } from './polygon-relations'
import { roofSegmentFrame } from './roof-frame'
import {
  getRoofSegmentShellSeat,
  getRoofSegmentShellSupport,
  type RoofShellSupport,
  type RoofSurfaceResult,
  type RoofSurfaceSeat,
} from './roof-surface'
import type { RoofSurfaceTriangle } from './roof-surface-geometry'

type Point = [number, number]
export type DormerPlacement = {
  localFootprint: Point[]
  planFootprint: Point[]
  roofId: string
  segmentId: string
  gradient: number
  shellSeat: RoofSurfaceSeat
}
export type DormerPlacementFailure = {
  ok: false
  code: string
  message: string
  reason: string
  nodeIds?: string[]
  details?: Record<string, unknown>
}
export type DormerPlacementResult = { ok: true; value: DormerPlacement } | DormerPlacementFailure
export type DormerCreationOptions = Partial<
  Omit<DormerNode, 'id' | 'type' | 'parentId' | 'roofSegmentId' | 'position' | 'children'>
>
export type DormerCreationPlan = {
  dormer: DormerNode
  window: WindowNode
  placement: DormerPlacement
  exposure: DormerWindowExposure
}
export type DormerCreationResult = { ok: true; value: DormerCreationPlan } | DormerPlacementFailure

const refuse = (
  code: string,
  reason: string,
  message: string,
  nodeIds?: string[],
  details?: Record<string, unknown>,
): DormerPlacementFailure => ({ ok: false, code, reason, message, nodeIds, details })

function surfaceFailure(result: Exclude<RoofSurfaceResult<unknown>, { status: 'supported' }>) {
  if (result.status === 'unmeasured')
    return refuse(
      'dormer_geometry_unmeasured',
      result.reason,
      'The physical roof shell is unresolved beneath the dormer.',
      result.nodeIds,
    )
  if (result.reason === 'invalid-host')
    return refuse('invalid_roof_host', result.reason, 'The dormer needs a reciprocal roof host.')
  return refuse(
    'too_wide',
    'outside-support',
    'The entire dormer footprint must be supported by the trimmed roof shell.',
  )
}

function validDormer(node: DormerNode): boolean {
  return (
    [
      node.width,
      node.depth,
      node.height,
      node.roofHeight,
      node.wallSkirtHeight,
      node.rotation,
      ...node.position,
    ].every(Number.isFinite) &&
    node.width > 0 &&
    node.depth > 0 &&
    node.height >= 0 &&
    node.roofHeight >= 0 &&
    node.wallSkirtHeight >= 0 &&
    DormerNode.shape.roofType.safeParse(node.roofType).success
  )
}

function footprint(node: DormerNode): Point[] {
  // Native own-conical construction swaps axes before generating a circle of diameter depth.
  // Retain the nominal wall/cutter width too: this is a conservative envelope, not a redesign.
  const width = Math.max(0.05, node.width, node.roofType === 'conical' ? node.depth : 0)
  const depth = Math.max(0.05, node.depth)
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(
    ([x, z]): Point => [
      node.position[0] + ((x! * width) / 2) * cos + ((z! * depth) / 2) * sin,
      node.position[2] - ((x! * width) / 2) * sin + ((z! * depth) / 2) * cos,
    ],
  )
}

/** Strict convex overlap: contact is allowed; the tolerance accounts only for double roundoff. */
function overlaps(a: Point[], b: Point[]): boolean {
  const origin = a[0]!
  const local = (points: Point[]) => points.map(([x, z]): Point => [x - origin[0], z - origin[1]])
  const left = local(a)
  const right = local(b)
  const scale = Math.max(1, ...[...a, ...b].flatMap((p) => p.map(Math.abs)))
  const tolerance = 32 * Number.EPSILON * scale
  for (const ring of [left, right]) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!
      const q = ring[(i + 1) % ring.length]!
      const length = Math.hypot(q[0] - p[0], q[1] - p[1])
      const nx = (q[1] - p[1]) / length
      const nz = (p[0] - q[0]) / length
      const project = (points: Point[]) => points.map(([x, z]) => x * nx + z * nz)
      const l = project(left)
      const r = project(right)
      if (
        Math.min(Math.max(...l), Math.max(...r)) - Math.max(Math.min(...l), Math.min(...r)) <=
        tolerance
      )
        return false
    }
  }
  return true
}

function validConstruction(segment: RoofSegmentNode): boolean {
  if (segment.roofType !== 'shed' || !segment.shedFootprintPieces) return true
  return segment.shedFootprintPieces.every((polygon) => {
    if (polygon.length < 3 || !polygon.every((p) => p.length === 2 && p.every(Number.isFinite)))
      return false
    const origin = polygon[0]!
    const area = polygon.reduce((sum, a, i) => {
      const b = polygon[(i + 1) % polygon.length]!
      return sum + (a[0] - origin[0]) * (b[1] - origin[1]) - (b[0] - origin[0]) * (a[1] - origin[1])
    }, 0)
    if (area === 0 || !Number.isFinite(area)) return false
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      if (a[0] === b[0] && a[1] === b[1]) return false
      for (let j = i + 2; j < polygon.length; j++) {
        if (i === 0 && j === polygon.length - 1) continue
        if (segmentsIntersect(a, b, polygon[j]!, polygon[(j + 1) % polygon.length]!)) return false
      }
    }
    return true
  })
}

function coplanar(a: RoofSurfaceTriangle, b: RoofSurfaceTriangle): boolean {
  if (Math.hypot(...a.normal.map((n, i) => n - b.normal[i]!)) > 1e-7) return false
  const origin = a.vertices[0]
  return b.vertices.every(
    (p) => Math.abs(a.normal.reduce((sum, n, i) => sum + n * (p[i]! - origin[i]!), 0)) <= 1e-7,
  )
}

/** Construction provenance separates smooth tessellation from authored slope/profile seams. */
function singleArchitecturalSlope(segment: RoofSegmentNode, support: RoofShellSupport): boolean {
  if (support.plane) return true
  if (segment.roofType === 'barrel' || segment.roofType === 'conical') return true
  if (segment.roofType !== 'shed' || !segment.arc) return false
  // Only the first native source is strip-faceted. Other sources (notably pinned infills)
  // are independent planes; a source-index change by itself is not a geometric break.
  const smooth = support.patches.filter(
    (p) => p.sourcePieceIndex === null || p.sourcePieceIndex === 0,
  )
  const other = support.patches.filter(
    (p) => p.sourcePieceIndex !== null && p.sourcePieceIndex !== 0,
  )
  if (!other.length) return true
  const planes = other.flatMap((p) => p.triangles)
  if (!smooth.length) return planes.every((t) => coplanar(planes[0]!, t))
  return support.triangles.every((t) => coplanar(support.triangles[0]!, t))
}

/** Admission only: never reseats/reorients an edit, allocates identities, or writes nodes. */
export function validateDormerPlacement(
  nodes: DormerScene,
  segment: RoofSegmentNode,
  candidate: DormerNode,
): DormerPlacementResult {
  const roof = dormerRoofHost(nodes, segment)
  if (!roof || candidate.parentId !== segment.id || candidate.roofSegmentId !== segment.id)
    return refuse('invalid_roof_host', 'invalid-host', 'The dormer needs a reciprocal roof host.')
  if (!validDormer(candidate))
    return refuse(
      'invalid_dormer',
      'invalid-dimensions',
      'Dormer dimensions and pose must be finite and physical.',
    )
  if (!validConstruction(segment))
    return refuse(
      'invalid_roof_host',
      'invalid-construction',
      'The stored roof footprint is not a simple polygon.',
    )
  const frame = roofSegmentFrame(roof, segment)
  const localFootprint = footprint(candidate)
  const planFootprint = localFootprint.map(frame.toPlan)
  for (const other of queryNodes<DormerNode>(nodes, { type: 'dormer' })) {
    if (other.id === candidate.id || other.metadata?.isTransient) continue
    const otherSegment = nodes[other.roofSegmentId ?? other.parentId ?? '']
    if (otherSegment?.type !== 'roof-segment' || otherSegment.parentId !== roof.id) continue
    if (!validDormer(other))
      return refuse(
        'invalid_dormer',
        'invalid-neighbor',
        'A neighboring dormer has unresolved extents.',
        [other.id],
      )
    const otherFrame = roofSegmentFrame(roof, otherSegment)
    if (overlaps(planFootprint, footprint(other).map(otherFrame.toPlan)))
      return refuse('overlaps_dormer', 'overlap', 'The dormer footprint overlaps another dormer.', [
        other.id,
      ])
  }
  const view = withoutDormerCut(nodes, candidate.id)
  const host = view[segment.id] as RoofSegmentNode
  const seat = getRoofSegmentShellSeat(
    roof,
    host,
    [candidate.position[0], candidate.position[2]],
    view,
  )
  if (seat.status !== 'supported') return surfaceFailure(seat)
  const [nx, ny, nz] = seat.value.normal
  const gradient = Math.hypot(nx, nz) / ny
  if (!Number.isFinite(gradient) || gradient + 16 * Number.EPSILON < 0.08)
    return refuse(
      'not_on_slope',
      'insufficient-slope',
      'A dormer needs a pitched centre with gradient at least 0.08.',
    )
  const support = getRoofSegmentShellSupport(roof, host, localFootprint, view)
  if (support.status !== 'supported') return surfaceFailure(support)
  if (!singleArchitecturalSlope(host, support.value))
    return refuse(
      'too_wide',
      'architectural-break',
      'The dormer would cross a ridge, hip, or architectural profile break.',
    )
  return {
    ok: true,
    value: {
      localFootprint,
      planFootprint,
      roofId: roof.id,
      segmentId: segment.id,
      gradient,
      shellSeat: seat.value,
    },
  }
}

/** Native fresh placement with one complete, unpublished dormer/window pair. */
export function planDormerCreation(
  nodes: DormerScene,
  segment: RoofSegmentNode,
  centre: readonly [number, number],
  options: DormerCreationOptions = {},
): DormerCreationResult {
  const roof = dormerRoofHost(nodes, segment)
  if (!roof)
    return refuse('invalid_roof_host', 'invalid-host', 'The dormer needs a reciprocal roof host.')
  if (!Array.isArray(centre) || centre.length !== 2 || !centre.every(Number.isFinite))
    return refuse(
      'invalid_dormer',
      'invalid-point',
      'Supply two finite segment-local coordinates [x, z].',
    )
  let draftId = 'dormer_placement'
  while (nodes[draftId]) draftId += '_'
  const names = new Set(queryNodes<DormerNode>(nodes, { type: 'dormer' }).map((n) => n.name))
  let number = 1
  while (names.has(`Dormer ${number}`)) number++
  const parsed = DormerNode.safeParse({
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    id: draftId,
    parentId: segment.id,
    roofSegmentId: segment.id,
    position: [centre[0], 0, centre[1]],
    children: [],
    name: options.name ?? `Dormer ${number}`,
    rotation: options.rotation ?? 0,
  })
  if (!parsed.success)
    return refuse(
      'invalid_dormer',
      'invalid-options',
      'Dormer options must match the native schema.',
    )
  const dormer = parsed.data
  // A new dormer is flashed at its roof junction unless asked otherwise; circular conical walls
  // have no supported apron yet. Stored dormers keep their authored (absent) flashing.
  dormer.flashing ??= dormer.roofType !== 'conical'
  if (!validDormer(dormer))
    return refuse(
      'invalid_dormer',
      'invalid-dimensions',
      'Dormer dimensions must be finite and physical.',
    )
  const planCentre = roofSegmentFrame(roof, segment).toPlan(centre)
  // Strict interior containment proves positive overlap for every positive-size candidate,
  // regardless of its not-yet-measured downhill yaw. Never erase a source cut to obtain a seat.
  for (const other of queryNodes<DormerNode>(nodes, { type: 'dormer' })) {
    if (other.metadata?.isTransient || !validDormer(other)) continue
    const host = nodes[other.roofSegmentId ?? other.parentId ?? '']
    if (host?.type !== 'roof-segment' || host.parentId !== roof.id) continue
    const point = roofSegmentFrame(roof, host).toLocal(planCentre)
    const dx = point[0] - other.position[0]
    const dz = point[1] - other.position[2]
    const cos = Math.cos(other.rotation)
    const sin = Math.sin(other.rotation)
    const x = dx * cos - dz * sin
    const z = dx * sin + dz * cos
    const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(point[0]), Math.abs(point[1]))
    const inside =
      other.roofType === 'conical'
        ? Math.hypot(x, z) < Math.max(0.05, other.depth) / 2 - tolerance
        : Math.abs(x) < Math.max(0.05, other.width) / 2 - tolerance &&
          Math.abs(z) < Math.max(0.05, other.depth) / 2 - tolerance
    if (inside)
      return refuse('overlaps_dormer', 'overlap', 'The dormer centre lies inside another dormer.', [
        other.id,
      ])
  }
  const seat = getRoofSegmentShellSeat(roof, segment, centre, nodes)
  if (seat.status !== 'supported') return surfaceFailure(seat)
  dormer.position = seat.value.position
  dormer.rotation =
    options.rotation ?? (Math.atan2(seat.value.normal[0], seat.value.normal[2]) || 0)
  const placement = validateDormerPlacement(nodes, segment, dormer)
  if (!placement.ok) return placement
  if (
    !Number.isFinite(dormer.windowWidth) ||
    dormer.windowWidth <= 0 ||
    Math.abs(dormer.windowOffsetX) + dormer.windowWidth / 2 > dormer.width / 2
  )
    return refuse(
      'window_too_wide',
      'window-fit',
      'The default window must fit the dormer wall width.',
    )
  if (!Number.isFinite(dormer.windowHeight) || dormer.windowHeight <= 0)
    return refuse(
      'invalid_dormer',
      'invalid-window',
      'The default window needs a positive finite height.',
    )
  const frontWindow = createDormerDefaultWindow(dormer, 'window_placement')
  const backWindow = { ...frontWindow, dormerFace: 'back' as const }
  const fits = (window: WindowNode) => {
    const bounds = getDormerWallOpeningVerticalBounds(
      dormer,
      window.dormerFace!,
      window.position[0],
      window.width,
    )
    const bottom = window.position[1] - window.height / 2
    const top = window.position[1] + window.height / 2
    const roundoff =
      16 *
      Number.EPSILON *
      Math.max(1, Math.abs(bounds.min), Math.abs(bounds.max), Math.abs(bottom), Math.abs(top))
    return bottom >= bounds.min - roundoff && top <= bounds.max + roundoff
  }
  const frontFits = fits(frontWindow)
  const backFits = fits(backWindow)
  if (!frontFits && !backFits)
    return refuse(
      'window_does_not_fit',
      'window-fit',
      'The default window must fit within the dormer wall skirt and ceiling.',
    )
  let window = frontFits ? frontWindow : backWindow
  let exposure = getDormerWindowExposure(dormer, window, segment, { nodes })
  if (exposure.status !== 'exposed' && window.dormerFace === 'front' && backFits) {
    window = backWindow
    exposure = getDormerWindowExposure(dormer, window, segment, { nodes })
  }
  if (exposure.status !== 'exposed')
    return refuse(
      'window_not_exposed',
      exposure.status === 'unmeasured' ? exposure.reason : 'buried-window',
      'The default window centre must clear the finished roof covering by more than 0.01 m.',
      exposure.nodeIds,
    )
  const id = generateId('dormer')
  const windowId = generateId('window')
  return {
    ok: true,
    value: {
      dormer: { ...dormer, id, children: [windowId] },
      window: { ...window, id: windowId, parentId: id, dormerId: id },
      placement: placement.value,
      exposure,
    },
  }
}
