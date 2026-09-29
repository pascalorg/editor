import type { AnyNodeId, CeilingNode as CeilingNodeType } from '../schema'
import { containsPoint, distanceToBoundary, type Ring } from './polygon-boolean'
import { type Point2D, pointFromTuple, pointToTuple } from './room-graph'

export function partitionCeilingChildren(
  ceiling: CeilingNodeType,
  roomIndices: number[],
  detected: Array<{ poly: Point2D[]; holes: Ring[] }>,
  fallbackRoomIndex: number | undefined,
  childPosition: (childId: AnyNodeId) => [number, number] | undefined,
) {
  const assignments = new Map<number, CeilingNodeType['children']>()
  for (const roomIndex of roomIndices) assignments.set(roomIndex, [])

  for (const childId of ceiling.children) {
    const tuple = childPosition?.(childId)
    const point = tuple ? pointFromTuple(tuple) : undefined
    const boundaryRoomIndices = point
      ? roomIndices.filter((roomIndex) => {
          const room = detected[roomIndex]
          return room
            ? distanceToBoundary(
                [{ outer: room.poly.map(pointToTuple), holes: room.holes }],
                pointToTuple(point),
              ) <= 1e-7
            : false
        })
      : []
    const interiorRoomIndex =
      point && boundaryRoomIndices.length === 0
        ? roomIndices.find((roomIndex) => {
            const room = detected[roomIndex]
            return room
              ? containsPoint(
                  [{ outer: room.poly.map(pointToTuple), holes: room.holes }],
                  pointToTuple(point),
                )
              : false
          })
        : undefined
    const roomIndex =
      interiorRoomIndex ??
      (fallbackRoomIndex !== undefined && boundaryRoomIndices.includes(fallbackRoomIndex)
        ? fallbackRoomIndex
        : boundaryRoomIndices[0]) ??
      fallbackRoomIndex ??
      roomIndices[0]
    if (roomIndex !== undefined) assignments.get(roomIndex)?.push(childId)
  }

  return assignments
}
