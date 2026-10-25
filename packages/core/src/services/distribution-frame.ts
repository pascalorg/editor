import type { AnyNode, AnyNodeId, BuildingNode } from '../schema'
import { getLevelElevations } from './storey'

export function distributionPointToWorld(
  node: AnyNode,
  point: readonly [number, number, number],
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  elevations = getLevelElevations(nodes),
): [number, number, number] {
  let ancestor: AnyNode | undefined = node
  const visited = new Set<AnyNodeId>()
  while (ancestor && ancestor.type !== 'level' && !visited.has(ancestor.id)) {
    visited.add(ancestor.id)
    ancestor = ancestor.parentId ? nodes[ancestor.parentId as AnyNodeId] : undefined
  }
  const elevation = ancestor?.type === 'level' ? elevations.get(ancestor.id) : undefined
  const building = elevation?.buildingId ? nodes[elevation.buildingId as AnyNodeId] : undefined
  let [x, y, z] = point
  y += elevation?.baseY ?? 0
  if (building?.type === 'building') {
    const { position, rotation } = building as BuildingNode
    const [rx, ry, rz] = rotation
    const zx = Math.cos(rz) * x - Math.sin(rz) * y
    const zy = Math.sin(rz) * x + Math.cos(rz) * y
    const yx = Math.cos(ry) * zx + Math.sin(ry) * z
    const yz = -Math.sin(ry) * zx + Math.cos(ry) * z
    x = yx + position[0]
    y = Math.cos(rx) * zy - Math.sin(rx) * yz + position[1]
    z = Math.sin(rx) * zy + Math.cos(rx) * yz + position[2]
  }
  return [x, y, z]
}

export type DistributionFrame = {
  origin: [number, number, number]
  axes: [number, number, number][]
}

export function distributionFrame(
  node: AnyNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  elevations = getLevelElevations(nodes),
): DistributionFrame {
  const origin = distributionPointToWorld(node, [0, 0, 0], nodes, elevations)
  const axes = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const
  ).map((axis) => {
    const point = distributionPointToWorld(node, axis, nodes, elevations)
    return point.map((value, i) => value - origin[i]!) as [number, number, number]
  })
  return { origin, axes }
}

export function distributionVectorToWorld(
  frame: DistributionFrame,
  point: readonly number[],
): [number, number, number] {
  return [0, 1, 2].map((i) =>
    frame.axes.reduce((sum, axis, j) => sum + axis[i]! * point[j]!, 0),
  ) as [number, number, number]
}

export function distributionPointFromWorld(
  frame: DistributionFrame,
  point: readonly number[],
): [number, number, number] {
  return frame.axes.map((axis) =>
    axis.reduce((sum, value, i) => sum + value * (point[i]! - frame.origin[i]!), 0),
  ) as [number, number, number]
}

export function distributionPointInFrame(
  frame: DistributionFrame,
  point: readonly number[],
): [number, number, number] {
  return distributionVectorToWorld(frame, point).map((value, i) => value + frame.origin[i]!) as [
    number,
    number,
    number,
  ]
}
