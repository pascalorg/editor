import type { WallFeaturePlacement } from '@pascal-app/core'
import { type Intersection, Mesh, type Object3D, type Raycaster, Vector3 } from 'three'

/** Pick only surfaces in the completed wall body, including the recess back and reveals. */
export function raycastWallFeature(
  target: Object3D,
  wall: Mesh,
  placement: WallFeaturePlacement,
  raycaster: Raycaster,
  hits: Intersection[],
) {
  const candidates: Intersection[] = []
  Mesh.prototype.raycast.call(wall, raycaster, candidates)
  candidates.sort((a, b) => a.distance - b.distance)
  const p = new Vector3()
  const b = placement.bounds
  for (const hit of candidates) {
    p.copy(hit.point)
    wall.worldToLocal(p)
    const y = p.y + wall.position.y
    const epsilon = 0.003
    if (
      p.x < b.u0 - epsilon ||
      p.x > b.u1 + epsilon ||
      y < b.y0 - epsilon ||
      y > b.y1 + epsilon ||
      p.z < b.n0 - epsilon ||
      p.z > b.n1 + epsilon
    )
      continue
    hits.push({ ...hit, object: target })
  }
}

export { hasDescendantHit } from '../shared/descendant-hit'
