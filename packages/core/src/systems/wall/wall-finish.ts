import { containsPoint } from '../../lib/polygon-boolean'
import { sampleWallPointsForRoomDetection, WALL_JUNCTION_TOLERANCE } from '../../lib/room-graph'
import type { AnyNode, AnyNodeId } from '../../schema'
import {
  getEffectiveWallFaceMaterial,
  WALL_FACE_REGION_LIMIT,
  WALL_SLOT_DEFAULT,
  type WallFace,
  type WallFaceRegion,
  type WallNode,
  type WallSurfaceMaterialSpec,
} from '../../schema/nodes/wall'
import type { ZoneNode } from '../../schema/nodes/zone'
import { isCurvedWall } from './wall-curve'

// Which finish shows at a point of a wall face. Resolution order, highest first:
//   face paint region → zone `wallOverrides` for this wall face → `wallMaterial`
//   of the zone that span faces → the wall's own face chain (slot → legacy → default).
// Spans come from the zones' stored reference polygons, so a long wall bordering
// two rooms on one face splits at the T-junction (span t0..t1).

/** A stretch of one wall face bordering one zone, in reference-line parameter space. */
export type WallZoneSpan = { zoneId: string; face: WallFace; t0: number; t1: number }

export type WallFinishSpan = {
  zoneId: string
  u0: number
  u1: number
  ref: string
  source: 'override' | 'zone'
}

export type WallFinishHit =
  | { source: 'region'; ref: string; regionId: string }
  | { source: 'override' | 'zone'; ref: string; zoneId: string }
  | { source: 'slot' }

export type WallFinishLayout = {
  /** Reference chord length (m); `u` runs 0..length. */
  length: number
  /** True when no region or room finish touches the wall: no splits, two face groups. */
  plain: boolean
  regions: Record<WallFace, WallFaceRegion[]>
  spans: Record<WallFace, WallFinishSpan[]>
  /** Stations (m from start) where triangles must split: region and span bounds. */
  uSplits: number[]
  /** Heights (m above the face base) where triangles must split: region bounds. */
  vSplits: number[]
  /**
   * Finish refs beyond the two face slots, sorted — material indices 3.. of the
   * wall's palette (0 = caps, 1 = face a chain, 2 = face b chain).
   */
  refs: string[]
}

const FACE_PROBE = 0.01
const SPLIT_EPSILON = 1e-6

function chord(wall: Pick<WallNode, 'start' | 'end'>) {
  // Unhealed saves can carry non-tuple endpoints; they have no faces to finish.
  if (!(Array.isArray(wall.start) && Array.isArray(wall.end))) return { dx: 0, dz: 0, length: 0 }
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  return { dx, dz, length: Number.isFinite(length) ? length : 0 }
}

function distanceToPolyline(point: [number, number], polyline: { x: number; y: number }[]) {
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const a = polyline[index]!
    const b = polyline[index + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((point[0] - a.x) * dx + (point[1] - a.y) * dy) / lengthSquared))
    best = Math.min(best, Math.hypot(point[0] - (a.x + dx * t), point[1] - (a.y + dy * t)))
  }
  return best
}

/**
 * Stretches of each wall face bordering a zone that lists the wall among its
 * boundary walls. Derived from the zone's stored reference polygon (outer ring
 * and holes): an edge lying on the wall's reference line borders that wall, and
 * the side the zone interior lies on names the face (a = left of start → end).
 */
export function getWallZoneSpans(
  wall: Pick<WallNode, 'id' | 'start' | 'end' | 'curveOffset'>,
  zones: readonly Pick<ZoneNode, 'id' | 'polygon' | 'holes' | 'boundaryWallIds'>[],
): WallZoneSpan[] {
  const { dx, dz, length } = chord(wall)
  if (length < 1e-9) return []
  const curved = isCurvedWall(wall)
  const polyline = sampleWallPointsForRoomDetection(wall)
  const tolerance = WALL_JUNCTION_TOLERANCE + 1e-6
  const rawStation = (point: readonly [number, number]) =>
    ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz) / (length * length)
  const lineDistance = (point: readonly [number, number]) =>
    Math.abs((point[0] - wall.start[0]) * dz - (point[1] - wall.start[1]) * dx) / length
  const spans: WallZoneSpan[] = []
  for (const zone of [...zones].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!zone.boundaryWallIds?.includes(wall.id as never)) continue
    const shape = [{ outer: zone.polygon, holes: zone.holes ?? [] }]
    for (const ring of [zone.polygon, ...(zone.holes ?? [])]) {
      if (ring.length < 3) continue
      for (let index = 0; index < ring.length; index += 1) {
        const p = ring[index]!
        const q = ring[(index + 1) % ring.length]!
        const ex = q[0] - p[0]
        const ez = q[1] - p[1]
        const edgeLength = Math.hypot(ex, ez)
        if (edgeLength < 1e-9) continue
        let t0: number
        let t1: number
        if (curved) {
          // An arc's sampled facets are room edges one to one.
          const mid: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
          if (
            distanceToPolyline(p, polyline) > tolerance ||
            distanceToPolyline(q, polyline) > tolerance ||
            distanceToPolyline(mid, polyline) > tolerance
          )
            continue
          t0 = Math.max(0, Math.min(rawStation(p), rawStation(q), 1))
          t1 = Math.min(1, Math.max(rawStation(p), rawStation(q), 0))
        } else {
          // A straight edge on the wall's line borders it where the two overlap,
          // even when the edge also runs along a collinear neighbour.
          if (lineDistance(p) > tolerance || lineDistance(q) > tolerance) continue
          t0 = Math.max(0, Math.min(rawStation(p), rawStation(q)))
          t1 = Math.min(1, Math.max(rawStation(p), rawStation(q)))
        }
        if ((t1 - t0) * length < 1e-6) continue
        // Probe across the edge at the middle of the shared stretch.
        const tm = (t0 + t1) / 2
        const edgeT = Math.max(
          0,
          Math.min(
            1,
            ((wall.start[0] + dx * tm - p[0]) * ex + (wall.start[1] + dz * tm - p[1]) * ez) /
              (edgeLength * edgeLength),
          ),
        )
        const mid: [number, number] = [p[0] + ex * edgeT, p[1] + ez * edgeT]
        const along = ex * dx + ez * dz >= 0 ? 1 : -1
        const nx = (-ez / edgeLength) * along
        const nz = (ex / edgeLength) * along
        const left = containsPoint(shape, [mid[0] + nx * FACE_PROBE, mid[1] + nz * FACE_PROBE])
        const right = containsPoint(shape, [mid[0] - nx * FACE_PROBE, mid[1] - nz * FACE_PROBE])
        if (left === right) continue
        spans.push({ zoneId: zone.id, face: left ? 'a' : 'b', t0, t1 })
      }
    }
  }
  spans.sort(
    (a, b) => a.face.localeCompare(b.face) || a.t0 - b.t0 || (a.zoneId < b.zoneId ? -1 : 1),
  )
  const merged: WallZoneSpan[] = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (
      last &&
      last.face === span.face &&
      last.zoneId === span.zoneId &&
      span.t0 <= last.t1 + SPLIT_EPSILON
    ) {
      last.t1 = Math.max(last.t1, span.t1)
      continue
    }
    merged.push({ ...span })
  }
  return merged
}

/** Zones on the wall's level, the only ones that can border it. */
export function getWallLevelZones(
  wall: Pick<WallNode, 'parentId'>,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): ZoneNode[] {
  const level = wall.parentId ? nodes[wall.parentId as AnyNodeId] : undefined
  const childIds = (level as { children?: readonly string[] } | undefined)?.children
  if (!Array.isArray(childIds)) return []
  const zones: ZoneNode[] = []
  for (const id of childIds) {
    const child = nodes[id]
    if (child?.type === 'zone') zones.push(child)
  }
  return zones
}

/** Whether a zone carries any finish its boundary walls render. */
export function zoneHasWallFinish(zone: Pick<ZoneNode, 'wallMaterial' | 'wallOverrides'>): boolean {
  return zone.wallMaterial !== undefined || (zone.wallOverrides?.length ?? 0) > 0
}

function regionIsEmpty(region: WallFaceRegion): boolean {
  return (
    (region.u0 !== undefined &&
      region.u1 !== undefined &&
      region.u1 - region.u0 <= SPLIT_EPSILON) ||
    (region.v0 !== undefined && region.v1 !== undefined && region.v1 - region.v0 <= SPLIT_EPSILON)
  )
}

function uniqueSorted(values: number[]): number[] {
  const out: number[] = []
  for (const value of [...values].sort((a, b) => a - b)) {
    if (out.length === 0 || value - out.at(-1)! > SPLIT_EPSILON) out.push(value)
  }
  return out
}

export function buildWallFinishLayout(
  wall: Pick<WallNode, 'id' | 'start' | 'end' | 'curveOffset' | 'faceRegions'>,
  zones: readonly ZoneNode[],
): WallFinishLayout {
  const { length } = chord(wall)
  const regions: Record<WallFace, WallFaceRegion[]> = { a: [], b: [] }
  for (const face of ['a', 'b'] as const) {
    regions[face] = (wall.faceRegions ?? [])
      .filter((region) => region.face === face && !regionIsEmpty(region))
      .slice(-WALL_FACE_REGION_LIMIT)
  }

  const spans: Record<WallFace, WallFinishSpan[]> = { a: [], b: [] }
  const finishZones = zones.filter(
    (zone) =>
      zone.wallMaterial !== undefined ||
      zone.wallOverrides?.some((entry) => entry.wallId === wall.id),
  )
  if (finishZones.length > 0) {
    const byId = new Map<string, ZoneNode>(finishZones.map((zone) => [zone.id, zone]))
    for (const span of getWallZoneSpans(wall, finishZones)) {
      const zone = byId.get(span.zoneId)!
      const override = zone.wallOverrides?.find(
        (entry) => entry.wallId === wall.id && entry.face === span.face,
      )
      const ref = override?.finish ?? zone.wallMaterial
      if (ref === undefined) continue
      // A span reaching a wall end runs past it, over the mitred corner of the face.
      spans[span.face].push({
        zoneId: zone.id,
        u0: span.t0 <= SPLIT_EPSILON ? Number.NEGATIVE_INFINITY : span.t0 * length,
        u1: span.t1 >= 1 - SPLIT_EPSILON ? Number.POSITIVE_INFINITY : span.t1 * length,
        ref,
        source: override ? 'override' : 'zone',
      })
    }
  }

  const all = [...regions.a, ...regions.b]
  const allSpans = [...spans.a, ...spans.b]
  const inside = (value: number | undefined): value is number =>
    value !== undefined && value > SPLIT_EPSILON && value < length - SPLIT_EPSILON
  const uSplits = uniqueSorted([
    ...all.flatMap((region) => [region.u0, region.u1].filter(inside)),
    ...allSpans.flatMap((span) => [span.u0, span.u1].filter(inside)),
  ])
  const vSplits = uniqueSorted(
    all.flatMap((region) =>
      [region.v0, region.v1].filter((value): value is number => value !== undefined),
    ),
  )
  // Always their own entries, even when a ref equals a face slot: index 1 / 2
  // must stay the face chains alone, so a face-slot preview never repaints a
  // region. Equal materials still share a batch run (canonical batch key).
  const refs = [
    ...new Set([...all.map((region) => region.finish), ...allSpans.map((span) => span.ref)]),
  ].sort()

  return {
    length,
    plain: all.length === 0 && allSpans.length === 0,
    regions,
    spans,
    uSplits,
    vSplits,
    refs,
  }
}

function within(value: number, low: number | undefined, high: number | undefined) {
  return (low === undefined || value >= low) && (high === undefined || value < high)
}

/**
 * The finish at station `u` (m from the wall start) and height `v` (m above the
 * face's own base) of one face. `{ source: 'slot' }` means the wall's own face
 * chain: `slots[face]` → legacy inline finish → the kind default.
 */
export function resolveWallFinish(
  layout: WallFinishLayout,
  face: WallFace,
  u: number,
  v: number,
): WallFinishHit {
  const regions = layout.regions[face]
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index]!
    if (within(u, region.u0, region.u1) && within(v, region.v0, region.v1))
      return { source: 'region', ref: region.finish, regionId: region.id }
  }
  for (const span of layout.spans[face]) {
    if (u >= span.u0 && u < span.u1)
      return { source: span.source, ref: span.ref, zoneId: span.zoneId }
  }
  return { source: 'slot' }
}

/** Palette index for a resolved finish: 1 / 2 for a face chain, 3.. for `layout.refs`. */
export function wallFinishMaterialIndex(
  layout: WallFinishLayout,
  face: WallFace,
  hit: WallFinishHit,
): number {
  if (hit.source === 'slot') return face === 'a' ? 1 : 2
  const index = layout.refs.indexOf(hit.ref)
  return index < 0 ? (face === 'a' ? 1 : 2) : 3 + index
}

/**
 * The wall's own chain for one face, in the order the renderer walks it:
 * `slots[face]` ref → legacy inline finish (per-face, then wall-wide) → the
 * declared default. A dangling ref renders the declared default.
 */
export type WallFaceChainFinish =
  | { kind: 'ref'; ref: string }
  | { kind: 'legacy'; spec: WallSurfaceMaterialSpec }
  | { kind: 'default'; ref: string }

export function resolveWallFaceChain(
  wall: Pick<WallNode, 'slots' | 'legacyFaceMaterials' | 'material' | 'materialPreset'>,
  face: WallFace,
): WallFaceChainFinish {
  const ref = wall.slots?.[face]
  if (ref) return { kind: 'ref', ref }
  const spec = getEffectiveWallFaceMaterial(wall, face)
  if (spec.materialPreset || spec.material) return { kind: 'legacy', spec }
  return { kind: 'default', ref: WALL_SLOT_DEFAULT[face] }
}

// Paint roles a wall resolves to (the paint tool offers `room:<zoneId>`):
//   `a` / `b` / `aSkirting` …  a wall slot
//   `region:<regionId>`         one paint region on the wall
//   `room:<zoneId>/<face>`      this wall face inside that room (zone `wallOverrides`)
//   `room:<zoneId>`             every wall of that room (zone `wallMaterial`)
export type WallPaintRole =
  | { kind: 'slot'; slotId: string }
  | { kind: 'region'; regionId: string }
  | { kind: 'room'; zoneId: string }
  | { kind: 'room-face'; zoneId: string; face: WallFace }

export function wallRegionRole(regionId: string): string {
  return `region:${regionId}`
}

/** "This room's walls": paints the zone's `wallMaterial`. */
export function wallRoomFinishRole(zoneId: string): string {
  return `room:${zoneId}`
}

/** "This wall face" inside a room: paints a zone `wallOverrides` entry. */
export function wallRoomFaceRole(zoneId: string, face: WallFace): string {
  return `room:${zoneId}/${face}`
}

export function parseWallPaintRole(
  role: string,
  isSlot: (slotId: string) => boolean,
): WallPaintRole | null {
  if (isSlot(role)) return { kind: 'slot', slotId: role }
  if (role.startsWith('region:')) {
    const regionId = role.slice('region:'.length)
    return regionId ? { kind: 'region', regionId } : null
  }
  if (!role.startsWith('room:')) return null
  const rest = role.slice('room:'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return rest ? { kind: 'room', zoneId: rest } : null
  const zoneId = rest.slice(0, slash)
  const face = rest.slice(slash + 1)
  return zoneId && (face === 'a' || face === 'b') ? { kind: 'room-face', zoneId, face } : null
}
