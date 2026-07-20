import { type AnyNodeId, sceneRegistry, spatialGridManager } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type Camera, Vector3 } from 'three'

const originScratch = new Vector3()
const hitScratch = new Vector3()

/**
 * Level-local elevation of the walking surface the pointer actually points
 * at, for use as the slab-support election cap (`maxElevation`).
 *
 * The grid event plane rides at the ghost's last height, so its hit point
 * alone can't be trusted (that feedback loop is what made a ghost under an
 * elevated deck blink between the deck top and the ground). But camera →
 * hit reconstructs the true pointer ray regardless of the plane height,
 * and the nearest slab plane that ray crosses inside its rendered polygon
 * IS the surface under the cursor — the deck top when aiming at the deck,
 * the floor/ground when aiming underneath it.
 *
 * Returns null when no level is active (callers fall back to the
 * uncapped max election).
 */
export function resolvePointerSupportElevation(
  camera: Camera,
  worldHit: readonly [number, number, number],
): number | null {
  const levelId = useViewer.getState().selection.levelId
  if (!levelId) return null

  camera.getWorldPosition(originScratch)
  hitScratch.set(worldHit[0], worldHit[1], worldHit[2])
  // Slab polygons/elevations live in the level frame; the level mesh
  // carries the storey Y offset and any building rotation.
  const levelMesh = sceneRegistry.nodes.get(levelId as AnyNodeId)
  if (levelMesh) {
    levelMesh.worldToLocal(originScratch)
    levelMesh.worldToLocal(hitScratch)
  }
  hitScratch.sub(originScratch)
  if (hitScratch.lengthSq() < 1e-12) return null

  return spatialGridManager.getPointedSupportSurface(
    levelId,
    [originScratch.x, originScratch.y, originScratch.z],
    [hitScratch.x, hitScratch.y, hitScratch.z],
  ).elevation
}
