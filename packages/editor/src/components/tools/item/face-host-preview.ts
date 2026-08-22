import type { Object3D } from 'three'

type Vector3Tuple = readonly [number, number, number]

type FaceBounds = {
  minU: number
  maxU: number
  minV: number
  maxV: number
}

export function applyFaceHostPreviewPose(
  mesh: Object3D,
  position: Vector3Tuple,
  rotation: Vector3Tuple,
): void {
  mesh.position.set(position[0], position[1], position[2])
  mesh.rotation.set(rotation[0], rotation[1], rotation[2])
}

export function resolveFaceHostSwitch(
  currentFaceId: string | null | undefined,
  nextFaceId: string | null | undefined,
  pendingFaceId: string | null,
): { accept: boolean; pendingFaceId: string | null } {
  if (!currentFaceId || !nextFaceId || currentFaceId === nextFaceId) {
    return { accept: true, pendingFaceId: null }
  }

  if (pendingFaceId === nextFaceId) {
    return { accept: true, pendingFaceId: null }
  }

  return { accept: false, pendingFaceId: nextFaceId }
}

export function shouldDetachFaceHostOnLeave(attachTo: string | undefined): boolean {
  return (
    attachTo === undefined ||
    attachTo === 'wall' ||
    attachTo === 'wall-side' ||
    attachTo === 'ceiling'
  )
}

export function clampFaceHostPosition(
  position: Vector3Tuple,
  bounds: FaceBounds,
  dimensions: readonly [width: number, height: number],
): [number, number, number] | null {
  const [width, height] = dimensions
  const minU = bounds.minU + width / 2
  const maxU = bounds.maxU - width / 2
  const minV = bounds.minV
  const maxV = bounds.maxV - height
  if (minU > maxU || minV > maxV) return null

  return [
    Math.min(maxU, Math.max(minU, position[0])),
    Math.min(maxV, Math.max(minV, position[1])),
    position[2],
  ]
}

export function clampFaceHostCenterPosition(
  position: Vector3Tuple,
  bounds: FaceBounds,
  dimensions: readonly [width: number, depth: number],
): [number, number, number] | null {
  const [width, depth] = dimensions
  const minU = bounds.minU + width / 2
  const maxU = bounds.maxU - width / 2
  const minV = bounds.minV + depth / 2
  const maxV = bounds.maxV - depth / 2
  if (minU > maxU || minV > maxV) return null

  return [
    Math.min(maxU, Math.max(minU, position[0])),
    Math.min(maxV, Math.max(minV, position[1])),
    position[2],
  ]
}
