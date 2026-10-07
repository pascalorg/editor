import type { AnyNode } from '../schema'

export type FloorPlatePaintRefusal = {
  status: 'refused'
  code: 'floor-surface-without-room'
  message: string
}

export function floorPlatePaintRefusal(
  nodes: Readonly<Record<string, AnyNode>>,
  node: AnyNode,
  role: string,
): FloorPlatePaintRefusal | undefined {
  if (
    node.type === 'slab' &&
    node.plateRole === 'base' &&
    role === 'surface' &&
    !node.zoneIds?.some((id) => nodes[id]?.type === 'zone' && nodes[id].hasFloor !== false)
  )
    return {
      status: 'refused',
      code: 'floor-surface-without-room',
      message: 'This structural floor band has no room finish to paint. Paint its edge instead.',
    }
}
