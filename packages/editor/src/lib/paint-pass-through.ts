import type { AnyNode } from '@pascal-app/core'
import { setSurfaceRaycastLayers } from '@pascal-app/viewer'
import { type Intersection, Mesh, type Object3D, type Ray, Raycaster } from 'three'

/**
 * Whether the paint pointer passes through `node`: a door or window with no
 * part under the cursor (an open garage door, the empty opening its proxy
 * spans) is not there for paint, so the surface behind it is what paints.
 */
export function paintPassesThrough(node: AnyNode, role: string | null): boolean {
  return role === null && (node.type === 'door' || node.type === 'window')
}

const drawnRaycaster = new Raycaster()
const partRaycaster = new Raycaster()
setSurfaceRaycastLayers(partRaycaster.layers)

const isWithin = (object: Object3D | null, root: Object3D) => {
  for (let at = object; at; at = at.parent) if (at === root) return true
  return false
}

/**
 * Whether the paintable part a door or window resolves behind its proxy is
 * hidden: its opening proxy wins the scene raycast, and the part is then
 * found along the whole ray — even past the floor seen through the opening.
 * A surface of anything else hit before that part (walls aside: their
 * collision meshes span the opening, see `wallHitInOpening`) is what the
 * pointer is on.
 */
export function openingPartHidden(
  opening: Object3D | null | undefined,
  ray: Ray,
  intersections: readonly Intersection[],
): boolean {
  if (!opening) return false
  partRaycaster.ray.copy(ray)
  const part = partRaycaster
    .intersectObject(opening, true)
    .find((hit) => typeof (hit.object.userData as { slotId?: unknown }).slotId === 'string')
  if (!part) return true
  return intersections.some(
    (hit) =>
      hit.distance < part.distance - 1e-4 &&
      hit.object.name !== WALL_COLLISION_MESH &&
      !isWithin(hit.object, opening),
  )
}

const WALL_COLLISION_MESH = 'collision-mesh'

/**
 * Whether a wall hit lands in one of the wall's holes. A wall is picked through
 * an uncut collision mesh, so its hits cover its openings too — the open garage
 * door, the step under a doorway. The wall as drawn (`drawn`, its registered
 * mesh, with the cuts) decides: nothing of it along the ray past the hit means
 * the pointer is looking through the wall, not at it. A hit on a reveal inside
 * the opening is still the wall.
 */
export function wallHitInOpening(
  drawn: Object3D | null | undefined,
  ray: Ray,
  hitDistance: number,
): boolean {
  if (!(drawn instanceof Mesh)) return false
  drawnRaycaster.ray.copy(ray)
  drawnRaycaster.far = Number.POSITIVE_INFINITY
  const hits: Intersection[] = []
  // The drawn mesh opts out of scene raycasts (batched walls); ask it directly.
  Mesh.prototype.raycast.call(drawn, drawnRaycaster, hits)
  // A ray through the opening can still clip the reveal behind the hit; allow
  // for the deepest wall a ray crosses at a grazing angle.
  return !hits.some((hit) => hit.distance <= hitDistance + WALL_DEPTH_ALLOWANCE)
}

const WALL_DEPTH_ALLOWANCE = 2
