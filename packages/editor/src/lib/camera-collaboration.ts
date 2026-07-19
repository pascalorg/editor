import type { CameraCollaborationPose } from '@pascal-app/core'

const MIN_PERSPECTIVE_FOV = 1
const MAX_PERSPECTIVE_FOV = 179
const INTERPOLATION_TIME_CONSTANT_SECONDS = 0.08
const MAX_INTERPOLATION_DELTA_SECONDS = 0.1
const INTERPOLATION_SETTLE_DISTANCE = 0.001

export type CameraCollaborationPoseApplicationPlan = {
  pose: CameraCollaborationPose
  perspectiveFov: number | null
}

export type CameraCollaborationInterpolationStep = {
  position: [number, number, number]
  settled: boolean
  target: [number, number, number]
}

function finiteVectorTuple(value: unknown): [number, number, number] | null {
  if (
    !(
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((component) => typeof component === 'number' && Number.isFinite(component))
    )
  ) {
    return null
  }

  return [value[0], value[1], value[2]]
}

export function normalizeCameraCollaborationPose(value: unknown): CameraCollaborationPose | null {
  if (!(typeof value === 'object' && value !== null)) {
    return null
  }

  const candidate = value as Partial<CameraCollaborationPose>
  const position = finiteVectorTuple(candidate.position)
  const target = finiteVectorTuple(candidate.target)
  if (
    !(
      position &&
      target &&
      (candidate.projection === 'perspective' || candidate.projection === 'orthographic')
    )
  ) {
    return null
  }

  if (
    candidate.fov !== undefined &&
    !(typeof candidate.fov === 'number' && Number.isFinite(candidate.fov))
  ) {
    return null
  }

  if (
    candidate.viewWidth !== undefined &&
    !(
      typeof candidate.viewWidth === 'number' &&
      Number.isFinite(candidate.viewWidth) &&
      candidate.viewWidth > 0
    )
  ) {
    return null
  }

  if (
    candidate.aspect !== undefined &&
    !(
      typeof candidate.aspect === 'number' &&
      Number.isFinite(candidate.aspect) &&
      candidate.aspect > 0
    )
  ) {
    return null
  }

  return {
    ...(candidate.aspect === undefined ? {} : { aspect: candidate.aspect }),
    ...(candidate.fov === undefined ? {} : { fov: candidate.fov }),
    position,
    projection: candidate.projection,
    target,
    ...(candidate.viewWidth === undefined ? {} : { viewWidth: candidate.viewWidth }),
  }
}

export function planCameraCollaborationPoseApplication(
  value: unknown,
): CameraCollaborationPoseApplicationPlan | null {
  const pose = normalizeCameraCollaborationPose(value)
  if (!pose) {
    return null
  }

  return {
    pose,
    perspectiveFov:
      pose.projection === 'perspective' && pose.fov !== undefined
        ? Math.min(Math.max(pose.fov, MIN_PERSPECTIVE_FOV), MAX_PERSPECTIVE_FOV)
        : null,
  }
}

function interpolateVectorTuple(
  current: [number, number, number],
  destination: [number, number, number],
  alpha: number,
): { settled: boolean; value: [number, number, number] } {
  const dx = destination[0] - current[0]
  const dy = destination[1] - current[1]
  const dz = destination[2] - current[2]
  const settleDistanceSquared = INTERPOLATION_SETTLE_DISTANCE ** 2
  if (dx * dx + dy * dy + dz * dz <= settleDistanceSquared) {
    return { settled: true, value: [...destination] }
  }

  const value: [number, number, number] = [
    current[0] + dx * alpha,
    current[1] + dy * alpha,
    current[2] + dz * alpha,
  ]
  const remainingX = destination[0] - value[0]
  const remainingY = destination[1] - value[1]
  const remainingZ = destination[2] - value[2]
  const settled =
    remainingX * remainingX + remainingY * remainingY + remainingZ * remainingZ <=
    settleDistanceSquared

  return { settled, value: settled ? [...destination] : value }
}

export function stepCameraCollaborationInterpolation(
  currentPosition: [number, number, number],
  currentTarget: [number, number, number],
  destination: CameraCollaborationPose,
  deltaSeconds: number,
): CameraCollaborationInterpolationStep {
  const finiteDelta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0
  const elapsed = Math.min(Math.max(finiteDelta, 0), MAX_INTERPOLATION_DELTA_SECONDS)
  const alpha = 1 - Math.exp(-elapsed / INTERPOLATION_TIME_CONSTANT_SECONDS)
  const position = interpolateVectorTuple(currentPosition, destination.position, alpha)
  const target = interpolateVectorTuple(currentTarget, destination.target, alpha)

  return {
    position: position.value,
    settled: position.settled && target.settled,
    target: target.value,
  }
}
