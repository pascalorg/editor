import type { BuildingPose } from '@pascal-app/core'

/** Snap in model-world units, independent of the rendered scene's XR scale. */
export function snapItemFloorPoint(
  local: readonly [number, number],
  pose: BuildingPose | null,
  dimensions: readonly [number, number],
  snap: (value: number, dimension: number) => number,
): [number, number] {
  const yaw = pose?.rotationY ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const px = pose?.position[0] ?? 0
  const pz = pose?.position[2] ?? 0
  const x = snap(px + local[0] * cos + local[1] * sin, dimensions[0]) - px
  const z = snap(pz - local[0] * sin + local[1] * cos, dimensions[1]) - pz
  return [x * cos - z * sin, x * sin + z * cos]
}
