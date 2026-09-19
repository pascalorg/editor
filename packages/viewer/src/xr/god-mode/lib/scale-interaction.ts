import { type Object3D, Vector3 } from 'three'

const Y_AXIS = new Vector3(0, 1, 0)
const GOD_SCALE_MIN = 0.05

export type GodScaleGestureMode = 'left' | 'right' | 'two'

export type GodScaleGesture = {
  mode: GodScaleGestureMode | null
  rootPosition?: Vector3
  rootRotationY?: number
  rootScale?: number
  startGrip?: Vector3
  startLeft?: Vector3
  startRight?: Vector3
}

export function isGodScaleInteractionEnabled(gestureMode: GodScaleGestureMode | null) {
  return gestureMode != null
}

export function resetGodScaleRoot(root: Object3D, gesture: GodScaleGesture) {
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.scale.setScalar(1)
  gesture.mode = null
}

export function resolveGodScalePan(
  rootPosition: Vector3,
  startGrip: Vector3,
  currentGrip: Vector3,
  target = new Vector3(),
  sensitivity = 1,
) {
  return target.copy(currentGrip).sub(startGrip).multiplyScalar(sensitivity).add(rootPosition)
}

export function resolveGodScaleTransform({
  rootPosition,
  rootScale,
  startLeft,
  startRight,
  currentLeft,
  currentRight,
  targetPosition = new Vector3(),
  translationSensitivity = 1,
  scaleSensitivity = 1,
  scaleAroundMidpoint = true,
}: {
  rootPosition: Vector3
  rootScale: number
  startLeft: Vector3
  startRight: Vector3
  currentLeft: Vector3
  currentRight: Vector3
  targetPosition?: Vector3
  translationSensitivity?: number
  scaleSensitivity?: number
  scaleAroundMidpoint?: boolean
}) {
  const startMidpoint = startLeft.clone().add(startRight).multiplyScalar(0.5)
  const currentMidpoint = currentLeft.clone().add(currentRight).multiplyScalar(0.5)
  const startVector = startRight.clone().sub(startLeft)
  const currentVector = currentRight.clone().sub(currentLeft)
  const startDistance = startVector.length()
  const currentDistance = currentVector.length()
  const rawScaleRatio = startDistance > 1e-6 ? currentDistance / startDistance : 1
  const scaleRatio = rawScaleRatio ** scaleSensitivity
  const scale = Math.max(GOD_SCALE_MIN, rootScale * scaleRatio)
  const effectiveScaleRatio = scale / rootScale
  const rotationY =
    Math.atan2(startVector.z, startVector.x) - Math.atan2(currentVector.z, currentVector.x)
  const translatedMidpoint = currentMidpoint
    .sub(startMidpoint)
    .multiplyScalar(translationSensitivity)

  if (scaleAroundMidpoint) {
    targetPosition
      .copy(rootPosition)
      .sub(startMidpoint)
      .multiplyScalar(effectiveScaleRatio)
      .applyAxisAngle(Y_AXIS, rotationY)
      .add(translatedMidpoint.add(startMidpoint))
  } else {
    targetPosition.copy(rootPosition).add(translatedMidpoint)
  }

  return { position: targetPosition, rotationY, scale }
}

export function applyGodScaleGesture({
  root,
  gesture,
  mode,
  leftPosition,
  rightPosition,
  targetPosition = new Vector3(),
  translationSensitivity = 3,
  scaleSensitivity = 1,
  scaleAroundMidpoint = false,
}: {
  root: Object3D
  gesture: GodScaleGesture
  mode: GodScaleGestureMode
  leftPosition: Vector3
  rightPosition: Vector3
  targetPosition?: Vector3
  translationSensitivity?: number
  scaleSensitivity?: number
  scaleAroundMidpoint?: boolean
}) {
  if (gesture.mode !== mode) {
    gesture.mode = mode
    gesture.rootPosition = root.position.clone()
    gesture.rootScale = root.scale.x
    gesture.rootRotationY = root.rotation.y
    if (mode === 'two') {
      gesture.startLeft = leftPosition.clone()
      gesture.startRight = rightPosition.clone()
    } else {
      gesture.startGrip = (mode === 'left' ? leftPosition : rightPosition).clone()
    }
  }

  if (mode === 'two') {
    const result = resolveGodScaleTransform({
      rootPosition: gesture.rootPosition!,
      rootScale: gesture.rootScale!,
      startLeft: gesture.startLeft!,
      startRight: gesture.startRight!,
      currentLeft: leftPosition,
      currentRight: rightPosition,
      targetPosition,
      translationSensitivity,
      scaleSensitivity,
      scaleAroundMidpoint,
    })
    root.position.copy(result.position)
    root.scale.setScalar(result.scale)
    root.rotation.y = gesture.rootRotationY! + result.rotationY
    return
  }

  const currentGrip = mode === 'left' ? leftPosition : rightPosition
  root.position.copy(
    resolveGodScalePan(
      gesture.rootPosition!,
      gesture.startGrip!,
      currentGrip,
      targetPosition,
      translationSensitivity,
    ),
  )
}
