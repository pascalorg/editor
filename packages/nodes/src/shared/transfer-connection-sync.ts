import {
  addTransferConnectionToMetadata,
  type AnyNode,
  type AnyNodeId,
  getTransferConnections,
  removeTransferConnectionsFromMetadata,
  type TransferConnection,
  type TransferPort,
} from '@pascal-app/core'

function connectionKeys(metadata: unknown) {
  return getTransferConnections({ metadata } as AnyNode)
    .map((connection) => `${connection.fromNodeId}:${connection.fromPort}->${connection.toNodeId}:${connection.toPort}`)
    .sort()
    .join('|')
}

function metadataConnectionsChanged(before: unknown, after: unknown) {
  return connectionKeys(before) !== connectionKeys(after)
}

export function removeMovingEndpointConnectionsFromPeers(args: {
  nodes: Record<string, AnyNode>
  movingNodeId: string
  movingPort: TransferPort
  updateNode: (id: AnyNodeId, updates: Partial<AnyNode>) => void
  markDirty?: (id: AnyNodeId) => void
}) {
  for (const node of Object.values(args.nodes)) {
    if (node.id === args.movingNodeId) continue
    if (getTransferConnections(node).length === 0) continue
    const metadata = removeTransferConnectionsFromMetadata(node.metadata, {
      nodeId: args.movingNodeId,
      port: args.movingPort,
    })
    if (!metadataConnectionsChanged(node.metadata, metadata)) continue
    args.updateNode(node.id, { metadata: metadata as AnyNode['metadata'] })
    args.markDirty?.(node.id)
  }
}

export function addConnectionToPeerNode(args: {
  nodes: Record<string, AnyNode>
  selfNodeId: string
  connection: TransferConnection
  updateNode: (id: AnyNodeId, updates: Partial<AnyNode>) => void
  markDirty?: (id: AnyNodeId) => void
}) {
  const peerId =
    args.connection.fromNodeId === args.selfNodeId
      ? args.connection.toNodeId
      : args.connection.fromNodeId
  const peer = args.nodes[peerId as AnyNodeId]
  if (!peer) return
  const metadata = addTransferConnectionToMetadata(peer.metadata, args.connection)
  if (!metadataConnectionsChanged(peer.metadata, metadata)) return
  args.updateNode(peer.id, { metadata: metadata as AnyNode['metadata'] })
  args.markDirty?.(peer.id)
}
