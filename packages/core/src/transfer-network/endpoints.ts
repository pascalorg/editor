import type { AnyNode, AnyNodeId, PipeNode } from '../schema'
import { getPipeEndpoint3D } from '../systems/pipe/pipe-centerline'
import type {
  ConveyorBeltRouteNode,
  TransferConnection,
  TransferPort,
} from './conveyor'
import { distance3D, isConveyorBeltRouteNode } from './conveyor'

export type TransferEndpointNode = ConveyorBeltRouteNode | PipeNode

export type TransferEndpointSnap = {
  point: [number, number, number]
  targetNodeId: AnyNodeId
  targetPort: TransferPort
  distance: number
}

export const TRANSFER_ENDPOINT_SNAP_DISTANCE = 0.28

export function isTransferEndpointNode(node: AnyNode | null | undefined): node is TransferEndpointNode {
  return isConveyorBeltRouteNode(node) || node?.type === 'pipe'
}

export function getTransferPortPoint(
  node: TransferEndpointNode,
  port: TransferPort,
): [number, number, number] | null {
  if (isConveyorBeltRouteNode(node)) {
    const point = port === 'in' ? node.points[0] : node.points[node.points.length - 1]
    return point ? [point[0], point[1], point[2]] : null
  }
  if (node.type === 'pipe') {
    const endpoint = getPipeEndpoint3D(node, port === 'in' ? 'start' : 'end')
    return [endpoint.x, endpoint.y, endpoint.z]
  }
  return null
}

export function resolveTransferEndpointSnap(args: {
  point: [number, number, number]
  nodes: Record<string, AnyNode>
  selfId?: string
  preferredTargetPort?: TransferPort
  nodeTypes?: ReadonlyArray<TransferEndpointNode['type']>
  threshold?: number
}): TransferEndpointSnap | null {
  const threshold = args.threshold ?? TRANSFER_ENDPOINT_SNAP_DISTANCE
  const nodeTypes = args.nodeTypes ? new Set(args.nodeTypes) : null
  let best: TransferEndpointSnap | null = null
  let bestPreferred: TransferEndpointSnap | null = null

  for (const node of Object.values(args.nodes)) {
    if (!isTransferEndpointNode(node)) continue
    if (node.id === args.selfId) continue
    if (nodeTypes && !nodeTypes.has(node.type)) continue
    for (const port of ['in', 'out'] as const) {
      const target = getTransferPortPoint(node, port)
      if (!target) continue
      const distance = distance3D(args.point, target)
      if (distance > threshold) continue
      const candidate: TransferEndpointSnap = {
        point: target,
        targetNodeId: node.id as AnyNodeId,
        targetPort: port,
        distance,
      }
      if (!best || distance < best.distance) best = candidate
      if (args.preferredTargetPort === port && (!bestPreferred || distance < bestPreferred.distance)) {
        bestPreferred = candidate
      }
    }
  }

  return bestPreferred ?? best
}

export function createTransferEndpointConnection(args: {
  selfNodeId: string
  selfPort: TransferPort
  targetNodeId: string
  targetPort: TransferPort
}): TransferConnection {
  if (args.selfPort === 'in') {
    return {
      fromNodeId: args.targetNodeId,
      fromPort: args.targetPort,
      toNodeId: args.selfNodeId,
      toPort: 'in',
    }
  }
  return {
    fromNodeId: args.selfNodeId,
    fromPort: 'out',
    toNodeId: args.targetNodeId,
    toPort: args.targetPort,
  }
}
