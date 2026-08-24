import type { CaptureSessionDescriptor } from '@pascal-app/capture-protocol'
import { Matrix4 } from 'three'

export function resolveCaptureFrameMatrix(
  descriptor: CaptureSessionDescriptor,
  frameId: string | undefined,
): Matrix4 | null {
  if (!frameId) return null
  const frames = new Map(descriptor.coordinateFrames.map((frame) => [frame.id, frame]))
  const visited = new Set<string>()
  const matrix = new Matrix4()
  let currentId: string | undefined = frameId

  while (currentId) {
    if (visited.has(currentId)) return null
    visited.add(currentId)
    const frame = frames.get(currentId)
    if (!frame) return null
    if (frame.transform) matrix.premultiply(new Matrix4().fromArray(frame.transform))
    currentId = frame.parentId
  }

  return matrix
}
