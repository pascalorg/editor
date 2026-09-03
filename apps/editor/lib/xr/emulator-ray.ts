import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'

export type EmulatedInputPose = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

const FORWARD = new Vector3(0, 0, -1)

export function resolveEmulatedInputPose(
  target: Object3D,
  referenceOrigin: Object3D,
  distance = 0.5,
): EmulatedInputPose {
  target.updateWorldMatrix(true, false)
  referenceOrigin.updateWorldMatrix(true, false)
  const targetPosition = target.getWorldPosition(new Vector3())
  const targetNormal = new Vector3(0, 0, 1).transformDirection(target.matrixWorld)
  const inputPosition = targetPosition.clone().addScaledVector(targetNormal, distance)
  const rayDirection = targetNormal.negate()
  const worldToReference = new Matrix4().copy(referenceOrigin.matrixWorld).invert()
  inputPosition.applyMatrix4(worldToReference)
  rayDirection.transformDirection(worldToReference)
  const quaternion = new Quaternion().setFromUnitVectors(FORWARD, rayDirection)
  return {
    position: inputPosition.toArray(),
    quaternion: quaternion.toArray(),
  }
}
