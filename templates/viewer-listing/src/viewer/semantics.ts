import { type AnimationClip, Box3, type Intersection, Mesh, type Object3D, Vector3 } from 'three'
import {
  findAncestorOfType,
  getNode,
  levelIdOf,
  type SceneGraph,
  type ZoneInfo,
  zoneArea,
  zoneContains,
  zoneInfo,
} from '../pascal'

/** What Pascal stamps on GLB nodes as glTF `extras` (three exposes them as `userData`). */
export type PascalExtras = {
  pascalId?: string
  kind?: string
  label?: string
  openable?: boolean
  clips?: string[]
  polygon?: [number, number][]
  color?: string
}

const extrasOf = (object: Object3D) => object.userData as PascalExtras

/** Kinds hidden while one floor is isolated, so the rooms read from above (a dollhouse). */
const CUTAWAY_KINDS = new Set(['ceiling', 'roof', 'roof-segment'])

/** The nearest object, itself included, that carries a Pascal identity. */
export function findIdentity(object: Object3D | null): Object3D | null {
  for (let current = object; current; current = current.parent) {
    if (extrasOf(current).pascalId) return current
  }
  return null
}

type ZoneEntry = ZoneInfo & { object: Object3D; label: string; levelId: string | null }

export type SceneIndex = {
  meshes: Map<Mesh, { levelId: string | null; cutaway: boolean }>
  zones: ZoneEntry[]
  clips: Map<string, AnimationClip>
  hasOpenables: boolean
}

/** The level an identity belongs to: from the graph, else from the GLB hierarchy. */
function levelOf(graph: SceneGraph, identity: Object3D): string | null {
  const id = extrasOf(identity).pascalId!
  if (getNode(graph, id)) return levelIdOf(graph, id)
  for (let current: Object3D | null = identity; current; current = current.parent) {
    const extras = extrasOf(current)
    if (extras.kind === 'level' && extras.pascalId) return extras.pascalId
  }
  return null
}

function isCutaway(identity: Object3D | null): boolean {
  for (let current = identity; current; current = findIdentity(current.parent)) {
    const kind = extrasOf(current).kind
    if (kind === 'level') return false
    if (kind && CUTAWAY_KINDS.has(kind)) return true
  }
  return false
}

export function indexScene(root: Object3D, graph: SceneGraph, clips: AnimationClip[]): SceneIndex {
  const index: SceneIndex = {
    meshes: new Map(),
    zones: [],
    clips: new Map(clips.map((clip) => [clip.name, clip])),
    hasOpenables: false,
  }
  root.traverse((object) => {
    const extras = extrasOf(object)
    if (extras.openable) index.hasOpenables = true
    if (object instanceof Mesh) {
      const identity = findIdentity(object)
      index.meshes.set(object, {
        levelId: identity ? levelOf(graph, identity) : null,
        cutaway: isCutaway(identity),
      })
    }
    if (extras.kind === 'zone' && extras.pascalId) {
      const node = getNode(graph, extras.pascalId) ?? {
        id: extras.pascalId,
        type: 'zone',
        name: extras.label,
      }
      const zone = zoneInfo(node, extras)
      if (zone) {
        index.zones.push({
          ...zone,
          object,
          label: zone.name ?? extras.label ?? 'Room',
          levelId: levelOf(graph, object),
        })
      }
    }
  })
  return index
}

/** What the camera frames: the buildings, not the site's parcel around them. */
export function focusBounds(root: Object3D): Box3 {
  const bounds = new Box3()
  root.traverse((object) => {
    if (extrasOf(object).kind === 'building') bounds.expandByObject(object)
  })
  return bounds.isEmpty() ? bounds.setFromObject(root) : bounds
}

/** The top of the site's own ground meshes, or null when the scene has no ground. */
export function groundHeight(root: Object3D): number | null {
  const ground = new Box3()
  root.traverse((object) => {
    if (object instanceof Mesh && extrasOf(findIdentity(object) ?? object).kind === 'site') {
      ground.expandByObject(object)
    }
  })
  return ground.isEmpty() ? null : ground.max.y
}

/** Shows every floor (`null`) or isolates one, hiding the others and the isolated floor's ceilings and roof. */
export function applyLevelVisibility(index: SceneIndex, levelId: string | null) {
  for (const [mesh, { levelId: meshLevel, cutaway }] of index.meshes) {
    mesh.visible = levelId === null || meshLevel === null || (meshLevel === levelId && !cutaway)
  }
}

function isShown(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

/** The nearest hit on something currently shown. */
export function firstVisibleHit(hits: readonly Intersection[]): Intersection | null {
  return hits.find((hit) => isShown(hit.object)) ?? null
}

export type RoomHover = { label: string; area: number }

const local = new Vector3()
const origin = new Vector3()

/** The zone whose outline holds a world point: on `levelId` when known, else the highest one at or below it. */
function zoneAtPoint(index: SceneIndex, point: Vector3, levelId: string | null): ZoneEntry | null {
  let best: ZoneEntry | null = null
  let bestY = Number.NEGATIVE_INFINITY
  for (const entry of index.zones) {
    if (levelId !== null && entry.levelId !== levelId) continue
    const y = entry.object.getWorldPosition(origin).y
    if (y > point.y + 0.25 || y <= bestY) continue
    local.copy(point)
    entry.object.worldToLocal(local)
    if (zoneContains(entry, local.x, local.z)) {
      best = entry
      bestY = y
    }
  }
  return best
}

/**
 * The room under a hit: the zone the hit node sits in by the graph, else the zone
 * whose outline contains the hit point (so floors, walls inside a room and
 * furniture all resolve to that room).
 */
export function roomAt(index: SceneIndex, graph: SceneGraph, hit: Intersection): RoomHover | null {
  const identity = findIdentity(hit.object)
  if (!identity) return null
  const byGraph = findAncestorOfType(graph, extrasOf(identity).pascalId!, 'zone')
  const zone =
    (byGraph && index.zones.find((entry) => entry.id === byGraph.id)) ||
    zoneAtPoint(index, hit.point, index.meshes.get(hit.object as Mesh)?.levelId ?? null)
  return zone ? { label: zone.label, area: zoneArea(zone) } : null
}

/** The openable door or window a hit belongs to, with its open clip. */
export function openableAt(
  index: SceneIndex,
  hit: Intersection,
): { id: string; clip: AnimationClip } | null {
  for (let current = findIdentity(hit.object); current; current = findIdentity(current.parent)) {
    const extras = extrasOf(current)
    if (!extras.openable) continue
    const names = [...(extras.clips ?? []), `${extras.pascalId}: open`]
    const clip = names.map((name) => index.clips.get(name)).find(Boolean)
    return clip ? { id: extras.pascalId!, clip } : null
  }
  return null
}
