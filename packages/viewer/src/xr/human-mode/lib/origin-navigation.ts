import type { Camera, Object3D, Vector3 } from 'three'

export function translateOrigin(
  origin: Object3D,
  movement: Vector3,
  playerPosition?: Vector3,
  resolvedPlayerPosition?: Vector3,
) {
  if (playerPosition && resolvedPlayerPosition) {
    resolvedPlayerPosition.copy(playerPosition).add(movement)
    origin.position.add(resolvedPlayerPosition.sub(playerPosition))
  } else {
    origin.position.add(movement)
  }
  origin.position.y = Math.max(0, origin.position.y)
}

export function rotateOriginAroundCamera(
  origin: Object3D,
  camera: Camera,
  angle: number,
  before: Vector3,
  after: Vector3,
) {
  camera.getWorldPosition(before)
  origin.rotation.y += angle
  camera.getWorldPosition(after)
  origin.position.x += before.x - after.x
  origin.position.z += before.z - after.z
}
