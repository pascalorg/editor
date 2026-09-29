import { containsPoint } from '../../lib/polygon-boolean'
import { roomFloorPlate } from '../../lib/room-floor-plate'
import { runAsSingleSceneHistoryStep } from '../../store/history-control'
import useScene from '../../store/use-scene'
import {
  type NodeChange,
  type StructureNodes,
  type StructurePlan,
  structureChangeBatch,
} from './shared'

export type CeilingHostAssignment = { nodeId: string; zoneId: string; offsetY: number }
export type SupportHostAssignment = {
  nodeId: string
  zoneId: string
  field: 'supportSlabId' | 'deckSlabId'
}
export type HostedZoneTransformPlan = StructurePlan & {
  ceilingHosts?: CeilingHostAssignment[]
  supportHosts?: SupportHostAssignment[]
}

export function resolveZoneTransformHosts(
  nodes: StructureNodes,
  plan: HostedZoneTransformPlan,
): NodeChange[] {
  const changes: NodeChange[] = (plan.ceilingHosts ?? []).map(({ nodeId, zoneId, offsetY }) => {
    const node = nodes[nodeId]
    const rooms = Object.values(nodes).filter(
      (candidate) =>
        candidate.type === 'zone' &&
        node &&
        'position' in node &&
        Array.isArray(node.position) &&
        candidate.parentId === node.parentId &&
        containsPoint(
          [{ outer: candidate.polygon, holes: candidate.holes }],
          [node.position[0], node.position[2]],
        ),
    )
    const room = rooms.find((room) => room.id === zoneId) ?? rooms[0]
    const ceiling = Object.values(nodes).find(
      (candidate) => candidate.type === 'ceiling' && candidate.zoneId === (room?.id ?? zoneId),
    )
    if (!node || !ceiling || !('position' in node) || !Array.isArray(node.position))
      throw Error(`Reconcile the copied room before assigning ceiling fixture ${nodeId}.`)
    return {
      op: 'update',
      id: node.id,
      data: { parentId: ceiling.id, position: [node.position[0], offsetY, node.position[2]] },
    }
  })
  for (const { nodeId, zoneId, field } of plan.supportHosts ?? []) {
    const plate = roomFloorPlate(
      Object.values(nodes).filter((node) => node.type === 'slab'),
      zoneId,
    )
    if (plate && nodes[nodeId])
      changes.push({ op: 'update', id: nodes[nodeId]!.id, data: { [field]: plate.id } })
  }
  return changes
}

// The store's synchronous subscriber (or a headless caller's reconcile callback)
// must create the ceiling before its copied fixtures can name that host.
export function applyZoneTransformPlan(
  plan: HostedZoneTransformPlan,
  runtime: {
    getNodes: () => StructureNodes
    applyChanges: (changes: NodeChange[]) => void
    reconcile: () => void
  } = {
    getNodes: () => useScene.getState().nodes,
    applyChanges: (changes) => useScene.getState().applyNodeChanges(structureChangeBatch(changes)),
    reconcile: () => {},
  },
) {
  if (!plan.changes.length) return
  runAsSingleSceneHistoryStep(useScene, () => {
    runtime.applyChanges(plan.changes)
    runtime.reconcile()
    const hosts = resolveZoneTransformHosts(runtime.getNodes(), plan)
    if (hosts.length) {
      runtime.applyChanges(hosts)
      runtime.reconcile()
    }
  })
}
