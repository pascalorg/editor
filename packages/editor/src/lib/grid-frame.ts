import type { BuildingPose } from '@pascal-app/core'
import { type Object3D, Quaternion, Vector3 } from 'three'

// Placement surfaces are world-space; the grid lives under the scalable XR
// scene root. Keep its lattice and reveal in that root's model coordinates.
export function gridLocalPoint(parent: Object3D | null, world: Vector3, target: Vector3) {
  target.copy(world)
  if (parent) {
    parent.updateWorldMatrix(true, false)
    parent.worldToLocal(target)
  }
  return target
}

export function gridLocalNormal(parent: Object3D | null, normal: Vector3, target: Vector3) {
  target.copy(normal)
  if (parent) target.transformDirection(parent.matrixWorld.clone().invert())
  return target
}

const UP = new Vector3(0, 1, 0)

/** Lays the grid's PlaneGeometry (which faces +Z) flat, its normal → +Y. */
export const HORIZONTAL_GRID_QUATERNION = new Quaternion().setFromUnitVectors(
  new Vector3(0, 0, 1),
  UP,
)

/**
 * Lay the horizontal grid plane on the lattice the active tools snap on: a
 * building's own frame (`pose`, its yaw and offset — the lattice
 * `snapWorldXZForActiveBuilding` snaps to), or with `pose` null the world XZ
 * grid anchored at (0, 0). The lattice lines run at multiples of the cell size
 * from the plane's origin, so a turned house's walls sit square on them. `y`
 * is the plane's height in the grid parent's frame.
 */
export function layHorizontalGrid(
  pose: BuildingPose | null,
  y: number,
  position: Vector3,
  quaternion: Quaternion,
) {
  position.set(pose?.position[0] ?? 0, y, pose?.position[2] ?? 0)
  quaternion.setFromAxisAngle(UP, pose?.rotationY ?? 0).multiply(HORIZONTAL_GRID_QUATERNION)
}
