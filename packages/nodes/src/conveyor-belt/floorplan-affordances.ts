import {
  addTransferConnectionToMetadata,
  type AnyNode,
  type AnyNodeId,
  createConveyorEndpointConnection,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  removeTransferConnectionsFromMetadata,
  resolveConveyorEndpointSnap,
  snapPointToGrid,
  type TransferPort,
  useScene,
} from '@pascal-app/core'
import { addConnectionToPeerNode, removeMovingEndpointConnectionsFromPeers } from './connection-sync'
import type { ConveyorBeltNode } from './schema'

type ConveyorEndpointPayload = {
  conveyorBeltId: AnyNodeId
  endpoint: 'start' | 'end'
}

function planPointDistance(a: readonly number[], b: readonly number[]) {
  return Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0))
}

function endpointPort(endpoint: 'start' | 'end'): TransferPort {
  return endpoint === 'start' ? 'in' : 'out'
}

function point3FromPlan(point: readonly [number, number], y = 0): [number, number, number] {
  return [point[0], y, point[1]]
}

function updateEndpoint(
  points: Array<[number, number, number]>,
  endpoint: 'start' | 'end',
  point: [number, number, number],
) {
  const next = points.map((entry) => [...entry] as [number, number, number])
  if (endpoint === 'start') next[0] = point
  else next[next.length - 1] = point
  return next
}

function removeMovedPortConnections(
  node: ConveyorBeltNode,
  endpoint: 'start' | 'end',
): Record<string, unknown> {
  return removeTransferConnectionsFromMetadata(node.metadata, {
    nodeId: node.id,
    port: endpointPort(endpoint),
  })
}

export const conveyorBeltMoveEndpointAffordance: FloorplanAffordance<ConveyorBeltNode> = {
  start({ node, payload }): FloorplanAffordanceSession {
    const { endpoint } = payload as ConveyorEndpointPayload
    const fixedPoint = endpoint === 'start' ? node.points[node.points.length - 1] : node.points[0]
    const port = endpointPort(endpoint)

    return {
      affectedIds: [node.id],
      apply({ planPoint, modifiers }) {
        if (!fixedPoint) return
        const scene = useScene.getState()
        const gridPoint = modifiers.shiftKey
          ? ([planPoint[0], planPoint[1]] as [number, number])
          : snapPointToGrid([planPoint[0], planPoint[1]])
        let routePoint = point3FromPlan(gridPoint)
        let metadata = removeMovedPortConnections(node, endpoint)
        removeMovingEndpointConnectionsFromPeers({
          nodes: scene.nodes as Record<string, AnyNode>,
          movingNodeId: node.id,
          movingPort: port,
          updateNode: scene.updateNode,
          markDirty: scene.markDirty,
        })

        if (!modifiers.altKey) {
          const snap = resolveConveyorEndpointSnap({
            point: routePoint,
            nodes: scene.nodes as Record<string, AnyNode>,
            selfId: node.id,
            preferredTargetPort: port === 'in' ? 'out' : 'in',
          })
          if (snap) {
            routePoint = snap.point
            const connection = createConveyorEndpointConnection({
              selfNodeId: node.id,
              selfPort: port,
              targetNodeId: snap.targetNodeId,
              targetPort: snap.targetPort,
            })
            metadata = addTransferConnectionToMetadata(metadata, connection)
            addConnectionToPeerNode({
              nodes: useScene.getState().nodes as Record<string, AnyNode>,
              selfNodeId: node.id,
              connection,
              updateNode: scene.updateNode,
              markDirty: scene.markDirty,
            })
          }
        }

        scene.updateNode(node.id, {
          points: updateEndpoint(node.points, endpoint, routePoint),
          metadata: metadata as typeof node.metadata,
        })
      },
      canCommit() {
        const finalNode = useScene.getState().nodes[node.id] as ConveyorBeltNode | undefined
        if (!finalNode || finalNode.type !== 'conveyor-belt') return false
        const first = finalNode.points[0]
        const last = finalNode.points[finalNode.points.length - 1]
        return !!(first && last && planPointDistance([first[0], first[2]], [last[0], last[2]]) > 0.1)
      },
    }
  },
}
