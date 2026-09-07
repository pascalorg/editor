import { type Euler, type Object3D, Vector3 } from 'three'

export type SceneTransform = {
  position: Vector3
  rotation: Euler
  scale: Vector3
}

export function captureGodSceneTransform(sceneRoot: Object3D | null): SceneTransform | null {
  if (!sceneRoot) return null
  return {
    position: sceneRoot.position.clone(),
    rotation: sceneRoot.rotation.clone(),
    scale: sceneRoot.scale.clone(),
  }
}

export function resetSceneForHumanScale(sceneRoot: Object3D | null) {
  if (!sceneRoot) return
  sceneRoot.position.set(0, 0, 0)
  sceneRoot.rotation.set(0, 0, 0)
  sceneRoot.scale.setScalar(1)
  sceneRoot.updateWorldMatrix(true, false)
}

export function restoreGodSceneTransform(
  sceneRoot: Object3D | null,
  transform: SceneTransform | null,
) {
  if (!sceneRoot || !transform) return false
  sceneRoot.position.copy(transform.position)
  sceneRoot.rotation.copy(transform.rotation)
  sceneRoot.scale.copy(transform.scale)
  sceneRoot.updateWorldMatrix(true, false)
  return true
}

export function resolveHumanPointInScene(
  sceneRoot: Object3D | null,
  worldPosition: Vector3,
  worldDirection: Vector3,
  target = new Vector3(),
  maximumDistance = 5,
) {
  if (!sceneRoot) return target.set(worldPosition.x, 0, worldPosition.z)

  sceneRoot.updateWorldMatrix(true, false)
  const inverseSceneMatrix = sceneRoot.matrixWorld.clone().invert()
  const localPosition = worldPosition.clone().applyMatrix4(inverseSceneMatrix)
  const localDirection = worldDirection.clone().transformDirection(inverseSceneMatrix)
  const worldScale = sceneRoot.getWorldScale(new Vector3())
  const minimumScale = Math.max(
    1e-6,
    Math.min(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z)),
  )
  const distance =
    Math.abs(localDirection.y) > 0.05 ? -localPosition.y / localDirection.y : maximumDistance
  const clampedDistance = Math.min(maximumDistance / minimumScale, Math.max(1, distance))
  return target.set(
    localPosition.x + localDirection.x * clampedDistance,
    0,
    localPosition.z + localDirection.z * clampedDistance,
  )
}

export function resolveXRHumanOriginTarget(
  humanPoint: Vector3,
  viewerLocalPosition: Vector3,
  target = new Vector3(),
) {
  return target.set(humanPoint.x - viewerLocalPosition.x, 0, humanPoint.z - viewerLocalPosition.z)
}
