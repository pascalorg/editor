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

// How a participant's placement transforms rigidly around / with the group:
//   - 'vec3'     position + [x,y,z] rotation (items, …)
//   - 'scalar'   position + numeric rotation (columns)
//   - 'endpoint' start/end tuples (walls, fences)
export type ParticipantKind = 'vec3' | 'scalar' | 'endpoint'

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

export function classifyParticipant(
  node: AnyNode | undefined,
  levelId: string | null,
  sceneNodes: Record<string, AnyNode | undefined>,
): ParticipantKind | null {
  if (!node || !isInGroupTransformScope(node, levelId, sceneNodes)) return null
  const p = getParticipantPosition(node)
  const r = (node as { rotation?: unknown }).rotation
  const start = (node as { start?: unknown }).start
  const end = (node as { end?: unknown }).end
  if (isVec3(p) && isVec3(r)) return 'vec3'
  if (isVec3(p) && getParticipantScalarRotation(node) !== null) return 'scalar'
  if (isVec2(start) && isVec2(end)) return 'endpoint'
  return null
}

// Pre-drag placement snapshot + how to transform it.
export type ParticipantStart =
  | { id: AnyNodeId; kind: 'vec3'; position: Vec3; rotation: Vec3 }
  | { id: AnyNodeId; kind: 'scalar'; position: Vec3; rotation: number }
  | { id: AnyNodeId; kind: 'endpoint'; start: Vec2; end: Vec2 }

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
    } else {
      const n = node as AnyNode & { start: Vec2; end: Vec2 }
      starts.push({
        id: id as AnyNodeId,
        kind,
        start: [n.start[0], n.start[1]],
        end: [n.end[0], n.end[1]],
      })
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
