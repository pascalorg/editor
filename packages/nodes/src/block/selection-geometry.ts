import type { BlockTopology } from '@pascal-app/core'
import type { Camera, Object3D } from 'three'
import { Vector2, Vector3 } from 'three'
import { type BlockSelection, blockSelectionVertexIds } from './commands'

export type BlockPoint = [number, number, number]

export function blockSelectionCentroid(
  topology: BlockTopology,
  selection: BlockSelection,
): BlockPoint | null {
  const ids = blockSelectionVertexIds(topology, selection)
  const positions = topology.vertices
    .filter((vertex) => ids.has(vertex.id))
    .map((vertex) => vertex.position)
  if (positions.length === 0) return null
  const total = positions.reduce<BlockPoint>(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
    [0, 0, 0],
  )
  return [total[0] / positions.length, total[1] / positions.length, total[2] / positions.length]
}

export function blockLocalPointToClient(
  point: BlockPoint,
  target: Object3D,
  camera: Camera,
  canvas: HTMLCanvasElement,
): Vector2 | null {
  target.updateWorldMatrix(true, false)
  const projected = target.localToWorld(new Vector3(...point)).project(camera)
  if (![projected.x, projected.y, projected.z].every(Number.isFinite)) return null
  const rect = canvas.getBoundingClientRect()
  return new Vector2(
    rect.left + ((projected.x + 1) / 2) * rect.width,
    rect.top + ((1 - projected.y) / 2) * rect.height,
  )
}
