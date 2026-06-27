import type { AnyNode, AnyNodeId } from '../schema'

export type TransferPort = 'in' | 'out'

export type TransferConnection = {
  fromNodeId: string
  fromPort: TransferPort
  toNodeId: string
  toPort: TransferPort
}

export type ConveyorBeltRouteNode = AnyNode & {
  type: 'conveyor-belt'
  points: Array<[number, number, number]>
  direction?: 'forward' | 'backward'
  elevation?: number
  thickness?: number
}

export type ConveyorEndpointSnap = {
  point: [number, number, number]
  targetNodeId: AnyNodeId
  targetPort: TransferPort
  distance: number
}

export const TRANSFER_ENDPOINT_SNAP_THRESHOLD = 0.15

export function isConveyorBeltRouteNode(node: AnyNode | null | undefined): node is ConveyorBeltRouteNode {
  return node?.type === 'conveyor-belt' && Array.isArray((node as ConveyorBeltRouteNode).points)
}

export function getConveyorPortPoint(
  node: ConveyorBeltRouteNode,
  port: TransferPort,
): [number, number, number] | null {
  const point = port === 'in' ? node.points[0] : node.points[node.points.length - 1]
  return point ? [point[0], point[1], point[2]] : null
}

export function distance3D(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

export function resolveConveyorEndpointSnap(args: {
  point: [number, number, number]
  nodes: Record<string, AnyNode>
  selfId?: string
  preferredTargetPort?: TransferPort
  threshold?: number
}): ConveyorEndpointSnap | null {
  const threshold = args.threshold ?? TRANSFER_ENDPOINT_SNAP_THRESHOLD
  let best: ConveyorEndpointSnap | null = null
  let bestPreferred: ConveyorEndpointSnap | null = null

  for (const node of Object.values(args.nodes)) {
    if (!isConveyorBeltRouteNode(node)) continue
    if (node.id === args.selfId) continue
    for (const port of ['in', 'out'] as const) {
      const target = getConveyorPortPoint(node, port)
      if (!target) continue
      const distance = distance3D(args.point, target)
      if (distance > threshold) continue
      if (!best || distance < best.distance) {
        best = {
          point: target,
          targetNodeId: node.id as AnyNodeId,
          targetPort: port,
          distance,
        }
      }
      if (args.preferredTargetPort === port && (!bestPreferred || distance < bestPreferred.distance)) {
        bestPreferred = {
          point: target,
          targetNodeId: node.id as AnyNodeId,
          targetPort: port,
          distance,
        }
      }
    }
  }

  return bestPreferred ?? best
}

export function createConveyorEndpointConnection(args: {
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

function connectionKey(connection: TransferConnection) {
  return `${connection.fromNodeId}:${connection.fromPort}->${connection.toNodeId}:${connection.toPort}`
}

function readConnections(metadata: unknown): TransferConnection[] {
  if (!metadata || typeof metadata !== 'object') return []
  const connections = (metadata as { transferConnections?: unknown }).transferConnections
  if (!Array.isArray(connections)) return []
  return connections.filter((connection): connection is TransferConnection => {
    if (!connection || typeof connection !== 'object') return false
    const candidate = connection as TransferConnection
    return (
      typeof candidate.fromNodeId === 'string' &&
      typeof candidate.toNodeId === 'string' &&
      (candidate.fromPort === 'in' || candidate.fromPort === 'out') &&
      (candidate.toPort === 'in' || candidate.toPort === 'out')
    )
  })
}

export function addTransferConnectionToMetadata(
  metadata: unknown,
  connection: TransferConnection,
): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? { ...(metadata as Record<string, unknown>) } : {}
  const existing = readConnections(base)
  const keys = new Set(existing.map(connectionKey))
  if (!keys.has(connectionKey(connection))) existing.push(connection)
  base.transferConnections = existing
  return base
}

export function removeTransferConnectionsFromMetadata(
  metadata: unknown,
  args: { nodeId: string; port?: TransferPort },
): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? { ...(metadata as Record<string, unknown>) } : {}
  const existing = readConnections(base)
  const filtered = existing.filter((connection) => {
    const matchesFrom =
      connection.fromNodeId === args.nodeId && (!args.port || connection.fromPort === args.port)
    const matchesTo =
      connection.toNodeId === args.nodeId && (!args.port || connection.toPort === args.port)
    return !(matchesFrom || matchesTo)
  })
  if (filtered.length === existing.length) return base
  if (filtered.length > 0) {
    base.transferConnections = filtered
  } else {
    delete base.transferConnections
  }
  return base
}

export function removeTransferConnectionsReferencingNodesFromMetadata(
  metadata: unknown,
  nodeIds: Iterable<string>,
): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? { ...(metadata as Record<string, unknown>) } : {}
  const deleted = new Set(nodeIds)
  if (deleted.size === 0) return base
  const existing = readConnections(base)
  const filtered = existing.filter(
    (connection) => !deleted.has(connection.fromNodeId) && !deleted.has(connection.toNodeId),
  )
  if (filtered.length === existing.length) return base
  if (filtered.length > 0) {
    base.transferConnections = filtered
  } else {
    delete base.transferConnections
  }
  return base
}

export function getTransferConnections(node: AnyNode): TransferConnection[] {
  return readConnections(node.metadata)
}

export function areConveyorPortsTouching(
  a: ConveyorBeltRouteNode,
  aPort: TransferPort,
  b: ConveyorBeltRouteNode,
  bPort: TransferPort,
  threshold = 0.001,
) {
  const aPoint = getConveyorPortPoint(a, aPort)
  const bPoint = getConveyorPortPoint(b, bPort)
  return !!(aPoint && bPoint && distance3D(aPoint, bPoint) <= threshold)
}
