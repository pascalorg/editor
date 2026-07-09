import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  resolveBuildingForLevel,
  sceneRegistry,
} from '@pascal-app/core'
import { Box3, Matrix4 } from 'three'

// Shared plumbing for the group transform gizmos (rotate + move). Both operate
// on the same multi-selection: classify each participant by how its placement
// transforms, snapshot pre-drag state, and pull connected wall/fence neighbours
// along so junctions stay welded.

// Outward clearance from a bbox corner so a gizmo doesn't sit on the geometry.
export const CORNER_OFFSET = 0.3
// Two endpoints within this distance count as the same junction — a hair looser
// than the store's 1e-6 so near-but-not-exact corners still hold together.
const JUNCTION_EPS = 1e-4

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number')
const isVec2Array = (v: unknown): v is Vec2[] => Array.isArray(v) && v.length > 0 && v.every(isVec2)

// How a participant's placement transforms rigidly around / with the group:
//   - 'vec3'     position + [x,y,z] rotation (items, …)
//   - 'scalar'   position + numeric rotation (columns)
//   - 'endpoint' start/end tuples (walls, fences)
//   - 'polygon'  [x,z] vertex arrays (slabs, ceilings, zones) — the placement
//                lives in the vertices themselves (plus optional hole rings)
export type ParticipantKind = 'vec3' | 'scalar' | 'endpoint' | 'polygon'

// A selected node qualifies when it belongs to the active level's horizontal
// frame: either parented to that level, or declared building-scoped and parented
// to the active level's building. Doors/windows parent to their wall, so they're
// excluded here and ride their wall.
function isInGroupTransformScope(
  node: AnyNode | undefined,
  levelId: string | null,
  sceneNodes: Record<string, AnyNode | undefined>,
): boolean {
  if (!node || !levelId) return false
  if (node.parentId === levelId) return true

  if (nodeRegistry.get(node.type)?.floorplanScope !== 'building') {
    return false
  }

  const buildingId = resolveBuildingForLevel(
    levelId as AnyNodeId,
    sceneNodes as Record<AnyNodeId, AnyNode>,
  )
  return Boolean(buildingId && node.parentId === buildingId)
}

function getLegacyScenePosition(node: AnyNode): Vec3 | null {
  if (node.type !== 'elevator') return null
  const object = sceneRegistry.nodes.get(node.id)
  if (!object) return [0, 0, 0]
  return [object.position.x, object.position.y, object.position.z]
}

function getParticipantPosition(node: AnyNode): Vec3 | null {
  const p = (node as { position?: unknown }).position
  if (isVec3(p)) return p
  return getLegacyScenePosition(node)
}

function getParticipantScalarRotation(node: AnyNode): number | null {
  const r = (node as { rotation?: unknown }).rotation
  if (typeof r === 'number' && Number.isFinite(r)) return r
  if (node.type !== 'elevator') return null
  return sceneRegistry.nodes.get(node.id)?.rotation.y ?? 0
}

// Shape-only classification of a positioned placement (no level-scope check).
// Used for polygon hosts' attached children, whose parent is the host rather
// than the level.
function classifyPlacementShape(node: AnyNode): 'vec3' | 'scalar' | null {
  const p = getParticipantPosition(node)
  const r = (node as { rotation?: unknown }).rotation
  if (isVec3(p) && isVec3(r)) return 'vec3'
  if (isVec3(p) && getParticipantScalarRotation(node) !== null) return 'scalar'
  return null
}

export function classifyParticipant(
  node: AnyNode | undefined,
  levelId: string | null,
  sceneNodes: Record<string, AnyNode | undefined>,
): ParticipantKind | null {
  if (!node || !isInGroupTransformScope(node, levelId, sceneNodes)) return null
  const shape = classifyPlacementShape(node)
  if (shape) return shape
  const start = (node as { start?: unknown }).start
  const end = (node as { end?: unknown }).end
  if (isVec2(start) && isVec2(end)) return 'endpoint'
  if (isVec2Array((node as { polygon?: unknown }).polygon)) return 'polygon'
  return null
}

// Pre-drag placement snapshot + how to transform it. `holes` is null when the
// kind carries no holes field (zone), so patches never write one onto it.
export type ParticipantStart =
  | { id: AnyNodeId; kind: 'vec3'; position: Vec3; rotation: Vec3 }
  | { id: AnyNodeId; kind: 'scalar'; position: Vec3; rotation: number }
  | { id: AnyNodeId; kind: 'endpoint'; start: Vec2; end: Vec2 }
  | { id: AnyNodeId; kind: 'polygon'; polygon: Vec2[]; holes: Vec2[][] | null }

// An unselected wall/fence sharing a junction with a transforming endpoint. Only
// the touching endpoint(s) follow, so the neighbour stays attached while its far
// end stays put (it stretches, mirroring single-wall move).
export type LinkedNeighbor = {
  id: AnyNodeId
  start: Vec2
  end: Vec2
  startLinked: boolean
  endLinked: boolean
}

const nearPoint = (a: Vec2, b: Vec2) =>
  Math.abs(a[0] - b[0]) <= JUNCTION_EPS && Math.abs(a[1] - b[1]) <= JUNCTION_EPS

// Snapshot the selected participants and the connected (unselected) wall/fence
// neighbours whose shared endpoints should follow the transform.
export function collectParticipants(
  ids: string[],
  sceneNodes: Record<string, AnyNode | undefined>,
  levelId: string | null,
): { starts: ParticipantStart[]; links: LinkedNeighbor[] } {
  const starts: ParticipantStart[] = []
  for (const id of ids) {
    const node = sceneNodes[id]
    const kind = classifyParticipant(node, levelId, sceneNodes)
    if (!node || !kind) continue
    if (kind === 'vec3') {
      const n = node as AnyNode & { position: Vec3; rotation: Vec3 }
      const position = getParticipantPosition(node)
      if (!position) continue
      starts.push({
        id: id as AnyNodeId,
        kind,
        position: [position[0], position[1], position[2]],
        rotation: [n.rotation[0], n.rotation[1], n.rotation[2]],
      })
    } else if (kind === 'scalar') {
      const position = getParticipantPosition(node)
      const rotation = getParticipantScalarRotation(node)
      if (!(position && rotation !== null)) continue
      starts.push({
        id: id as AnyNodeId,
        kind,
        position: [position[0], position[1], position[2]],
        rotation,
      })
    } else if (kind === 'endpoint') {
      const n = node as AnyNode & { start: Vec2; end: Vec2 }
      starts.push({
        id: id as AnyNodeId,
        kind,
        start: [n.start[0], n.start[1]],
        end: [n.end[0], n.end[1]],
      })
    } else {
      const n = node as AnyNode & { polygon: Vec2[]; holes?: Vec2[][] }
      starts.push({
        id: id as AnyNodeId,
        kind,
        polygon: n.polygon.map(([x, z]) => [x, z] as Vec2),
        holes: Array.isArray(n.holes)
          ? n.holes.map((hole) => hole.map(([x, z]) => [x, z] as Vec2))
          : null,
      })
    }
  }

  // Polygon hosts (slab/ceiling) rebuild their geometry from vertices rather
  // than transforming a group, so — unlike wall children, which ride the wall
  // mesh — their attached children (ceiling-mounted items) must transform
  // explicitly. Their positions are stored in the level frame (the host group
  // sits at the origin), so the same rigid patches apply.
  const includedIds = new Set<string>(starts.map((s) => s.id))
  for (const s of [...starts]) {
    if (s.kind !== 'polygon') continue
    const host = sceneNodes[s.id]
    const childIds = (host as { children?: string[] } | undefined)?.children
    if (!Array.isArray(childIds)) continue
    for (const childId of childIds) {
      if (includedIds.has(childId)) continue
      const child = sceneNodes[childId]
      if (!child) continue
      const shape = classifyPlacementShape(child)
      const position = child ? getParticipantPosition(child) : null
      if (!(shape && position)) continue
      if (shape === 'vec3') {
        const c = child as AnyNode & { rotation: Vec3 }
        starts.push({
          id: childId as AnyNodeId,
          kind: 'vec3',
          position: [position[0], position[1], position[2]],
          rotation: [c.rotation[0], c.rotation[1], c.rotation[2]],
        })
      } else {
        const rotation = getParticipantScalarRotation(child)
        if (rotation === null) continue
        starts.push({
          id: childId as AnyNodeId,
          kind: 'scalar',
          position: [position[0], position[1], position[2]],
          rotation,
        })
      }
      includedIds.add(childId)
    }
  }

  const endpoints: Vec2[] = []
  for (const s of starts) {
    if (s.kind === 'endpoint') endpoints.push(s.start, s.end)
  }
  const links: LinkedNeighbor[] = []
  if (endpoints.length > 0) {
    const selected = new Set(starts.map((s) => s.id))
    for (const [nid, node] of Object.entries(sceneNodes)) {
      if (selected.has(nid as AnyNodeId)) continue
      if (classifyParticipant(node, levelId, sceneNodes) !== 'endpoint') continue
      const n = node as AnyNode & { start: Vec2; end: Vec2 }
      const start: Vec2 = [n.start[0], n.start[1]]
      const end: Vec2 = [n.end[0], n.end[1]]
      const startLinked = endpoints.some((p) => nearPoint(start, p))
      const endLinked = endpoints.some((p) => nearPoint(end, p))
      if (startLinked || endLinked) {
        links.push({ id: nid as AnyNodeId, start, end, startLinked, endLinked })
      }
    }
  }
  return { starts, links }
}

// Grow a selection to the full connected component of walls/fences: any
// endpoint node transitively reachable through shared junctions from a selected
// endpoint node joins in, so the whole rigid structure transforms as one piece
// (rather than tearing/stretching at the boundary). Non-endpoint selections
// (items, columns) pass through unchanged.
export function expandToComponent(
  selectedIds: string[],
  sceneNodes: Record<string, AnyNode | undefined>,
  levelId: string | null,
): string[] {
  const endpoints: { id: string; start: Vec2; end: Vec2 }[] = []
  for (const [id, node] of Object.entries(sceneNodes)) {
    if (classifyParticipant(node, levelId, sceneNodes) === 'endpoint') {
      const n = node as AnyNode & { start: Vec2; end: Vec2 }
      endpoints.push({ id, start: [n.start[0], n.start[1]], end: [n.end[0], n.end[1]] })
    }
  }
  const included = new Set(selectedIds)
  if (!endpoints.some((e) => included.has(e.id))) return selectedIds

  let changed = true
  while (changed) {
    changed = false
    for (const e of endpoints) {
      if (included.has(e.id)) continue
      const touches = endpoints.some(
        (o) =>
          included.has(o.id) &&
          (nearPoint(e.start, o.start) ||
            nearPoint(e.start, o.end) ||
            nearPoint(e.end, o.start) ||
            nearPoint(e.end, o.end)),
      )
      if (touches) {
        included.add(e.id)
        changed = true
      }
    }
  }
  return Array.from(included)
}

// Per-node field patch, keyed for `useLiveNodeOverrides.setMany` during a live
// preview and for the single batched `updateNodes` on commit.
export type GroupPatch = readonly [AnyNodeId, Record<string, unknown>]

// Rigid group rotation: orbit each participant's anchor point(s) CCW by
// `delta` (atan2 x→z sense) around `center` (level-frame XZ) and turn yaws by
// `-delta` to match three.js Y-rotation handedness (same convention as the
// single-item rotate handle in item/definition.ts). Endpoint nodes
// (walls/fences) have no yaw — swinging both endpoints around the pivot
// rotates them rigidly; their curveOffset sagitta is rotation-invariant, so
// arcs are preserved. Linked neighbours' shared endpoints land exactly on the
// selected wall's rotated endpoint (rot is deterministic), keeping junctions
// welded while the far end stays put.
export function rotateGroupPatches(
  starts: ParticipantStart[],
  links: LinkedNeighbor[],
  center: { x: number; z: number },
  delta: number,
): GroupPatch[] {
  const cos = Math.cos(delta)
  const sin = Math.sin(delta)
  const rot = (x: number, z: number): Vec2 => {
    const dx = x - center.x
    const dz = z - center.z
    return [center.x + dx * cos - dz * sin, center.z + dx * sin + dz * cos]
  }
  const patches: GroupPatch[] = []
  for (const s of starts) {
    if (s.kind === 'endpoint') {
      patches.push([s.id, { start: rot(s.start[0], s.start[1]), end: rot(s.end[0], s.end[1]) }])
    } else if (s.kind === 'polygon') {
      const patch: Record<string, unknown> = { polygon: s.polygon.map(([x, z]) => rot(x, z)) }
      if (s.holes) patch.holes = s.holes.map((hole) => hole.map(([x, z]) => rot(x, z)))
      patches.push([s.id, patch])
    } else {
      const [px, pz] = rot(s.position[0], s.position[2])
      const position: Vec3 = [px, s.position[1], pz]
      const rotation =
        s.kind === 'vec3'
          ? ([s.rotation[0], s.rotation[1] - delta, s.rotation[2]] as Vec3)
          : s.rotation - delta
      patches.push([s.id, { position, rotation }])
    }
  }
  for (const l of links) {
    patches.push([
      l.id,
      {
        start: l.startLinked ? rot(l.start[0], l.start[1]) : l.start,
        end: l.endLinked ? rot(l.end[0], l.end[1]) : l.end,
      },
    ])
  }
  return patches
}

// Rotate the SNAPSHOTS themselves (same math as `rotateGroupPatches`, but
// producing new snapshot shapes instead of node patches). Lets an in-flight
// group move re-seed its rest state after a mid-drag R/T: subsequent
// translate patches then place the rotated layout at the live delta.
export function rotateGroupSnapshots(
  starts: ParticipantStart[],
  links: LinkedNeighbor[],
  center: { x: number; z: number },
  delta: number,
): { starts: ParticipantStart[]; links: LinkedNeighbor[] } {
  const cos = Math.cos(delta)
  const sin = Math.sin(delta)
  const rot = (x: number, z: number): Vec2 => {
    const dx = x - center.x
    const dz = z - center.z
    return [center.x + dx * cos - dz * sin, center.z + dx * sin + dz * cos]
  }
  const rotatedStarts = starts.map((s): ParticipantStart => {
    if (s.kind === 'endpoint') {
      return { ...s, start: rot(s.start[0], s.start[1]), end: rot(s.end[0], s.end[1]) }
    }
    if (s.kind === 'polygon') {
      return {
        ...s,
        polygon: s.polygon.map(([x, z]) => rot(x, z)),
        holes: s.holes ? s.holes.map((hole) => hole.map(([x, z]) => rot(x, z))) : null,
      }
    }
    const [px, pz] = rot(s.position[0], s.position[2])
    const position: Vec3 = [px, s.position[1], pz]
    if (s.kind === 'vec3') {
      return { ...s, position, rotation: [s.rotation[0], s.rotation[1] - delta, s.rotation[2]] }
    }
    return { ...s, position, rotation: s.rotation - delta }
  })
  // Only the welded (linked) endpoints follow the rotation; the far ends
  // stay put, exactly like the per-tick patch path.
  const rotatedLinks = links.map(
    (l): LinkedNeighbor => ({
      ...l,
      start: l.startLinked ? rot(l.start[0], l.start[1]) : l.start,
      end: l.endLinked ? rot(l.end[0], l.end[1]) : l.end,
    }),
  )
  return { starts: rotatedStarts, links: rotatedLinks }
}

// Level-frame XZ extents of the participant DATA — the mesh-free sibling of
// `computeGroupBox`, used when meshes aren't mounted yet and to re-seed
// alignment anchors after a mid-drag rotation.
export function participantExtents(
  starts: ParticipantStart[],
): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  const reach = (x: number, z: number) => {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  for (const s of starts) {
    if (s.kind === 'endpoint') {
      reach(s.start[0], s.start[1])
      reach(s.end[0], s.end[1])
    } else if (s.kind === 'polygon') {
      for (const [x, z] of s.polygon) {
        reach(x, z)
      }
    } else {
      reach(s.position[0], s.position[2])
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minZ, maxX, maxZ }
}

// Rigid group slide: shift every participant (and each linked neighbour's
// shared endpoint) by the same level-frame XZ delta. Y and rotations untouched.
export function translateGroupPatches(
  starts: ParticipantStart[],
  links: LinkedNeighbor[],
  dx: number,
  dz: number,
): GroupPatch[] {
  const patches: GroupPatch[] = []
  const shift = ([x, z]: Vec2): Vec2 => [x + dx, z + dz]
  for (const s of starts) {
    if (s.kind === 'endpoint') {
      patches.push([s.id, { start: shift(s.start), end: shift(s.end) }])
    } else if (s.kind === 'polygon') {
      const patch: Record<string, unknown> = { polygon: s.polygon.map(shift) }
      if (s.holes) patch.holes = s.holes.map((hole) => hole.map(shift))
      patches.push([s.id, patch])
    } else {
      patches.push([s.id, { position: [s.position[0] + dx, s.position[1], s.position[2] + dz] }])
    }
  }
  for (const l of links) {
    patches.push([
      l.id,
      {
        start: l.startLinked ? [l.start[0] + dx, l.start[1] + dz] : l.start,
        end: l.endLinked ? [l.end[0] + dx, l.end[1] + dz] : l.end,
      },
    ])
  }
  return patches
}

// Frozen world matrix of the level group + its inverse. A node's placement
// (`position` / `start` / `end`) is stored in its parent level's frame, but the
// gizmos raycast the ground plane in WORLD space. When the building is rotated
// those frames diverge, so a world-space drag delta / rotation pivot must be
// converted into the level frame before it's written back to placements —
// otherwise the move drifts off-axis from the cursor and the rotation orbits a
// displaced centre. Returns identity matrices when the level isn't mounted, which
// collapses to the old behaviour (world == local) for an unrotated building.
export function levelFrame(levelId: string | null): { matrix: Matrix4; inverse: Matrix4 } {
  const obj = levelId ? sceneRegistry.nodes.get(levelId as AnyNodeId) : null
  if (!obj) return { matrix: new Matrix4(), inverse: new Matrix4() }
  obj.updateWorldMatrix(true, false)
  const matrix = obj.matrixWorld.clone()
  return { matrix, inverse: matrix.clone().invert() }
}

// World-space union bounding box of the selected meshes, or null if none are
// mounted yet. Used to place the gizmos (which are portalled to the scene root,
// so they live in world space); placement writes convert back to the level frame
// via `levelFrame`.
export function computeGroupBox(ids: string[]): Box3 | null {
  const box = new Box3()
  const tmp = new Box3()
  let found = false
  for (const id of ids) {
    const obj = sceneRegistry.nodes.get(id)
    if (!obj) continue
    obj.updateWorldMatrix(true, true)
    tmp.setFromObject(obj)
    if (tmp.isEmpty()) continue
    box.union(tmp)
    found = true
  }
  return found ? box : null
}
