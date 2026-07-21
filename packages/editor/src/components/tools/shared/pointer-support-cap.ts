import { type AnyNodeId, sceneRegistry, spatialGridManager } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type Camera, Vector3 } from 'three'

const originScratch = new Vector3()
const hitScratch = new Vector3()
const worldScratch = new Vector3()
const pointScratch = new Vector3()

export type PointerSupportSurface = {
  /** Level-local elevation of the pointed surface — the election cap. */
  elevation: number
  /** World-space Y of the same surface, for grid-plane / preview placement. */
  worldY: number
  /**
   * World-space point where the pointer ray meets the pointed surface's
   * plane, or null when the ray never reaches it. Unlike the grid event's
   * own hit — whose XZ is perspective-skewed whenever the event plane
   * rides at a different storey than the aimed-at surface — this point
   * depends only on the ray and the pointed surface, so a preview /
   * election fed from it cannot flip with the event plane's height.
   */
  worldPoint: [number, number, number] | null
  /** {@link PointerSupportSurface.worldPoint} in the grid event's
   *  `localPosition` (building-local) frame — a drop-in replacement for
   *  the event's plane-hit XZ. */
  localPoint: [number, number, number] | null
}

/**
 * The walking surface the pointer actually points at: its level-local
 * elevation (for use as the slab-support election cap, `maxElevation`),
 * its world-space Y (for riding the grid event plane / draw preview on
 * it), and the ray's crossing of that surface's plane (the plan point the
 * cursor indicates).
 *
 * The grid event plane rides at the ghost's last height, so its hit point
 * alone can't be trusted (that feedback loop is what made a ghost under an
 * elevated deck blink between the deck top and the ground). But camera →
 * hit reconstructs the true pointer ray regardless of the plane height,
 * and the nearest slab plane that ray crosses inside its rendered polygon
 * IS the surface under the cursor — the deck top when aiming at the deck,
 * the floor/ground when aiming underneath it. The same reasoning applies
 * to the cursor XZ: the event plane's hit is skewed along the ray whenever
 * the plane sits on a different storey than the pointed surface, so
 * callers should place at `localPoint` / `worldPoint`, not the event hit.
 *
 * Returns null when no level is active (callers fall back to the
 * uncapped max election and the raw event hit).
 */
export function resolvePointerSupportSurface(
  camera: Camera,
  worldHit: readonly [number, number, number],
): PointerSupportSurface | null {
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

  const { elevation, point } = spatialGridManager.getPointedSupportSurface(
    levelId,
    [originScratch.x, originScratch.y, originScratch.z],
    [hitScratch.x, hitScratch.y, hitScratch.z],
  )
  const worldY = levelMesh ? levelMesh.localToWorld(worldScratch.set(0, elevation, 0)).y : elevation

  let worldPoint: [number, number, number] | null = null
  let localPoint: [number, number, number] | null = null
  if (point) {
    pointScratch.set(point[0], elevation, point[1])
    if (levelMesh) levelMesh.localToWorld(pointScratch)
    worldPoint = [pointScratch.x, pointScratch.y, pointScratch.z]
    // Same frame the grid events report `localPosition` in (use-grid-events).
    const buildingId = useViewer.getState().selection.buildingId
    const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
    if (buildingMesh) buildingMesh.worldToLocal(pointScratch)
    localPoint = [pointScratch.x, pointScratch.y, pointScratch.z]
  }

  return { elevation, worldY, worldPoint, localPoint }
}

/** {@link resolvePointerSupportSurface}, elevation only — the election cap. */
export function resolvePointerSupportElevation(
  camera: Camera,
  worldHit: readonly [number, number, number],
): number | null {
  return resolvePointerSupportSurface(camera, worldHit)?.elevation ?? null
}
