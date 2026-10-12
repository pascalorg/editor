import { type AnyNode, resolveLevelId, type WallNode } from '@pascal-app/core'
import * as THREE from 'three'
import {
  capPatchAt,
  getLevelRoofPatches,
  patchHeight,
  ROOF_CLEARANCE,
  type RoofUndersidePatch,
  segmentCrossing,
} from '../roof/roof-underside'

/**
 * Walls cut by the roof above them.
 *
 * A roof whose underside (the bottom of the deck) covers a wall's centreline
 * below the wall top cuts the wall there — every wall, explicit height or
 * not, so nothing pokes through a roof. Walls never grow towards a roof: what
 * closes the attic is the roof's business, not the room layout below. Every
 * other mesh is cut by `roof-clip`.
 *
 * Any roof in the wall's building counts while its underside is above the
 * wall's base. Only 3D geometry changes: the plan, stored heights, the spatial
 * grid and the roof elevation that follows wall tops keep the storey height.
 */

export type WallRoofCover = {
  /** Patches near the wall, heights in the wall's level-local frame. */
  patches: RoofUndersidePatch[]
}

export type WallRoofStation = {
  /** Wall-local x (along the wall). */
  x: number
  /** Cap heights (level-local) on the low-z and high-z cutter sides, just before `x`. */
  before: [number, number]
  /** Same, just after `x`. */
  after: [number, number]
}

export type WallRoofProfile = {
  stations: WallRoofStation[]
  /** Wall-local z of the two cutter sides. */
  zMin: number
  zMax: number
  /** Highest cap, level-local. */
  maxTop: number
}

// Sampling offset either side of a station: well under any modelled feature,
// well above float noise at house coordinates.
const STATION_EPSILON = 1e-4
const HEIGHT_EPSILON = 1e-4
// The cutter overhangs the wall footprint so CSG never meets coplanar faces.
const CUTTER_SIDE_MARGIN = 0.02
const CUTTER_END_MARGIN = 0.02
const CUTTER_HEADROOM = 1

function wallPlanBounds(wall: WallNode) {
  const pad = (wall.thickness ?? 0.2) + Math.abs(wall.curveOffset ?? 0) + 1
  return {
    minX: Math.min(wall.start[0], wall.end[0]) - pad,
    maxX: Math.max(wall.start[0], wall.end[0]) + pad,
    minZ: Math.min(wall.start[1], wall.end[1]) - pad,
    maxZ: Math.max(wall.start[1], wall.end[1]) + pad,
  }
}

/**
 * The roofs that can cut `wall`, or null when no roof reaches it (the wall
 * then builds exactly as before).
 */
export function resolveWallRoofCover(
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
): WallRoofCover | null {
  const levelId = resolveLevelId(wall, nodes as Record<string, AnyNode>)
  const level = getLevelRoofPatches(nodes, levelId)
  if (!level) return null
  const bounds = wallPlanBounds(wall)
  const patches = level.patches.filter(
    (patch) =>
      patch.maxX >= bounds.minX &&
      patch.minX <= bounds.maxX &&
      patch.maxZ >= bounds.minZ &&
      patch.minZ <= bounds.maxZ,
  )
  return patches.length > 0 ? { patches } : null
}

/**
 * Cap heights along the wall, sampled where the cap can change: wall ends,
 * roof outline crossings of the centreline, and where two roof planes (or a
 * roof plane and the wall top) cross along it. Between stations one plane
 * (or the flat top) caps the wall, so the profile is exact for straight walls.
 *
 * `toPlan` maps wall-local (x, z) to building plan space; `xRange` / `zRange`
 * bound the wall's local footprint; heights are level-local.
 */
export function buildWallRoofProfile(input: {
  cover: WallRoofCover
  toPlan: (x: number, z: number) => [number, number]
  xRange: [number, number]
  zRange: [number, number]
  normalTop: number
  base: number
}): WallRoofProfile | null {
  const { cover, toPlan, normalTop, base } = input
  const x0 = input.xRange[0] - CUTTER_END_MARGIN
  const x1 = input.xRange[1] + CUTTER_END_MARGIN
  const zMin = input.zRange[0] - CUTTER_SIDE_MARGIN
  const zMax = input.zRange[1] + CUTTER_SIDE_MARGIN
  const zMid = (input.zRange[0] + input.zRange[1]) / 2
  if (!(x1 - x0 > 1e-6)) return null

  const centerStart = toPlan(x0, zMid)
  const centerEnd = toPlan(x1, zMid)
  const xs = new Set<number>([x0, x1])
  const addT = (t: number) => {
    if (t > 0 && t < 1) xs.add(x0 + (x1 - x0) * t)
  }
  for (const patch of cover.patches) {
    for (let index = 0; index < patch.polygon.length; index++) {
      const t = segmentCrossing(
        centerStart,
        centerEnd,
        patch.polygon[index]!,
        patch.polygon[(index + 1) % patch.polygon.length]!,
      )
      if (t !== null) addT(t)
    }
  }
  // Height of a plane along the centreline is linear in t: h(t) = h0 + (h1 - h0) t.
  const along = cover.patches.map(
    (patch) => [patchHeight(patch, ...centerStart), patchHeight(patch, ...centerEnd)] as const,
  )
  const levels = [normalTop, base + ROOF_CLEARANCE]
  for (let i = 0; i < along.length; i++) {
    const [hi0, hi1] = along[i]!
    for (const level of levels) {
      if (Math.abs(hi1 - hi0) > 1e-12) addT((level - hi0) / (hi1 - hi0))
    }
    for (let j = i + 1; j < along.length; j++) {
      const [hj0, hj1] = along[j]!
      const slope = hi1 - hi0 - (hj1 - hj0)
      if (Math.abs(slope) > 1e-12) addT((hj0 - hi0) / slope)
    }
  }

  const sampleCap = (x: number): [number, number] => {
    const cap = capPatchAt(cover.patches, ...toPlan(x, zMid), base)
    if (!cap || cap.height >= normalTop) return [normalTop, normalTop]
    return [
      Math.min(patchHeight(cap.patch, ...toPlan(x, zMin)), normalTop),
      Math.min(patchHeight(cap.patch, ...toPlan(x, zMax)), normalTop),
    ]
  }

  const sorted = [...xs].sort((a, b) => a - b)
  const stations: WallRoofStation[] = []
  for (const x of sorted) {
    if (stations.length > 0 && x - stations[stations.length - 1]!.x < STATION_EPSILON * 4) continue
    stations.push({
      x,
      before: x > x0 ? sampleCap(x - STATION_EPSILON) : sampleCap(x + STATION_EPSILON),
      after: x < x1 ? sampleCap(x + STATION_EPSILON) : sampleCap(x - STATION_EPSILON),
    })
  }
  // The last kept station must close the cutter at the far end.
  const last = stations[stations.length - 1]!
  if (last.x < x1) {
    last.x = x1
    last.before = sampleCap(x1 - STATION_EPSILON)
    last.after = last.before
  }

  const changed = stations.some((station) =>
    [...station.before, ...station.after].some(
      (height) => Math.abs(height - normalTop) > HEIGHT_EPSILON,
    ),
  )
  return changed ? { stations, zMin, zMax, maxTop: normalTop } : null
}

/**
 * A closed solid holding everything above the profile, up to `maxTop`
 * plus headroom, in wall-local space shifted by `yOffset` (level-local →
 * mesh-local). Subtracting it from the wall prism leaves the roof-fitted wall.
 */
export function buildWallRoofCutterGeometry(
  profile: WallRoofProfile,
  yOffset: number,
): THREE.BufferGeometry {
  const { stations, zMin, zMax } = profile
  const top = profile.maxTop + CUTTER_HEADROOM + yOffset
  const positions: number[] = []
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const scratchA = new THREE.Vector3()
  const scratchB = new THREE.Vector3()
  const pushTriangle = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    out: THREE.Vector3,
  ) => {
    const normal = scratchA.subVectors(b, a).cross(scratchB.subVectors(c, a))
    if (normal.lengthSq() < 1e-16) return
    if (normal.dot(out) < 0) [b, c] = [c, b]
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  }
  const pushPolygon = (points: THREE.Vector3[], out: THREE.Vector3) => {
    // Planar, axis-aligned faces: triangulate in the two in-plane axes.
    const axisU = Math.abs(out.x) > 0.5 ? 'z' : 'x'
    const axisV = Math.abs(out.y) > 0.5 ? 'z' : 'y'
    const unique = points.filter(
      (point, index) => point.distanceToSquared(points[(index + 1) % points.length]!) > 1e-14,
    )
    if (unique.length < 3) return
    const contour = unique.map((point) => new THREE.Vector2(point[axisU], point[axisV]))
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      pushTriangle(unique[a!]!, unique[b!]!, unique[c!]!, out)
    }
  }
  const down = v(0, -1, 0)
  const up = v(0, 1, 0)
  const sideMin = v(0, 0, -1)
  const sideMax = v(0, 0, 1)

  const bottom = (station: WallRoofStation, which: 'before' | 'after', side: 0 | 1) =>
    v(station.x, station[which][side] + yOffset, side === 0 ? zMin : zMax)

  for (let index = 0; index < stations.length - 1; index++) {
    const a = stations[index]!
    const b = stations[index + 1]!
    const a0 = bottom(a, 'after', 0)
    const a1 = bottom(a, 'after', 1)
    const b0 = bottom(b, 'before', 0)
    const b1 = bottom(b, 'before', 1)
    pushTriangle(a0, a1, b1, down)
    pushTriangle(a0, b1, b0, down)
    pushPolygon([v(a.x, top, zMin), v(b.x, top, zMin), v(b.x, top, zMax), v(a.x, top, zMax)], up)
    // Sides: include each station's other bottom vertex so the faces share
    // every vertex with the risers (no T-junctions).
    for (const side of [0, 1] as const) {
      const z = side === 0 ? zMin : zMax
      const ring = [bottom(a, 'after', side), bottom(b, 'before', side)]
      if (index + 1 < stations.length - 1) {
        const next = bottom(b, 'after', side)
        if (next.y > ring[1]!.y) ring.push(next)
      }
      ring.push(v(b.x, top, z), v(a.x, top, z))
      if (index > 0) {
        const previous = bottom(a, 'before', side)
        if (previous.y > ring[0]!.y) ring.push(previous)
      }
      pushPolygon(ring, side === 0 ? sideMin : sideMax)
    }
  }

  // Risers where the cap steps at a station; outward is towards the higher side.
  for (let index = 1; index < stations.length - 1; index++) {
    const station = stations[index]!
    const lb = bottom(station, 'before', 0)
    const la = bottom(station, 'after', 0)
    const rb = bottom(station, 'before', 1)
    const ra = bottom(station, 'after', 1)
    const dl = la.y - lb.y
    const dr = ra.y - rb.y
    if (Math.abs(dl) < 1e-9 && Math.abs(dr) < 1e-9) continue
    if (dl * dr >= 0) {
      const out = v(dl + dr > 0 ? 1 : -1, 0, 0)
      pushTriangle(lb, la, ra, out)
      pushTriangle(lb, ra, rb, out)
    } else {
      const t = dl / (dl - dr)
      const cross = lb.clone().lerp(rb, t)
      pushTriangle(lb, la, cross, v(dl > 0 ? 1 : -1, 0, 0))
      pushTriangle(cross, ra, rb, v(dr > 0 ? 1 : -1, 0, 0))
    }
  }

  const first = stations[0]!
  const last = stations[stations.length - 1]!
  pushPolygon(
    [
      bottom(first, 'after', 0),
      bottom(first, 'after', 1),
      v(first.x, top, zMax),
      v(first.x, top, zMin),
    ],
    v(-1, 0, 0),
  )
  pushPolygon(
    [
      bottom(last, 'before', 0),
      bottom(last, 'before', 1),
      v(last.x, top, zMax),
      v(last.x, top, zMin),
    ],
    v(1, 0, 0),
  )

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

const roofWallSignatures = new Map<string, string>()

/** Fingerprint of the roofs that can cut a wall: a change rebuilds the wall. */
export function wallRoofCoverSignature(cover: WallRoofCover | null): string {
  if (!cover) return ''
  const round = (value: number) => value.toFixed(4)
  return JSON.stringify(
    cover.patches.map((patch) => [
      round(patch.a),
      round(patch.b),
      round(patch.c),
      patch.polygon.map(([x, z]) => `${round(x)},${round(z)}`).join(' '),
    ]),
  )
}

export function rememberWallRoofSignature(wallId: string, signature: string) {
  if (signature) roofWallSignatures.set(wallId, signature)
  else roofWallSignatures.delete(wallId)
}

function isRoofInput(node: AnyNode | undefined): boolean {
  const type = node?.type
  return type === 'roof' || type === 'roof-segment' || type === 'level' || type === 'building'
}

/** Whether a scene change touched anything a roof underside is built from. */
export function roofInputsChanged(
  nodes: Readonly<Record<string, AnyNode>>,
  previousNodes: Readonly<Record<string, AnyNode>>,
): boolean {
  for (const id in nodes) {
    if (
      nodes[id] !== previousNodes[id] &&
      (isRoofInput(nodes[id]) || isRoofInput(previousNodes[id]))
    )
      return true
  }
  for (const id in previousNodes) {
    if (!nodes[id] && isRoofInput(previousNodes[id])) return true
  }
  return false
}

/**
 * Marks the walls whose roof cover changed. Roof edits do not touch walls in
 * the scene, so without this a wall would keep the cap of the roof it was
 * built under.
 */
export function syncWallRoofFit(
  nodes: Readonly<Record<string, AnyNode>>,
  previousNodes: Readonly<Record<string, AnyNode>>,
  markDirty: (id: string) => void,
) {
  if (nodes === previousNodes || !roofInputsChanged(nodes, previousNodes)) return
  for (const wallId of roofWallSignatures.keys()) {
    if (nodes[wallId]?.type !== 'wall') roofWallSignatures.delete(wallId)
  }
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall') continue
    const signature = wallRoofCoverSignature(resolveWallRoofCover(node as WallNode, nodes))
    if (signature !== (roofWallSignatures.get(node.id) ?? '')) markDirty(node.id)
  }
}
