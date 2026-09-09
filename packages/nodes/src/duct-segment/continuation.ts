import {
  type AnyNode,
  type AnyNodeId,
  type DuctFittingNode,
  type FloorplanAffordance,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  findMatedScenePorts,
  planDuctElbowBranchPromotion,
  planDuctTeeCrossPromotion,
  type RunContinuationHandlePlan,
  resolveDuctContinuationHandle,
} from '../shared/elbow-branch-continuation'
import type { RunBodyHit, ScenePort } from '../shared/ports'
import { ductPortDiameterIn } from './geometry'
import type { DuctSegmentNode } from './schema'

export type DuctEndpoint = 'start' | 'end'

export type DuctContinuationSeed = {
  duct: DuctSegmentNode
  port: ScenePort | null
  body: RunBodyHit | null
  promotedFitting?: DuctFittingNode
}

type DuctContinuationDefaults = {
  continuation?: {
    nodeId?: unknown
    endpoint?: unknown
    fittingId?: unknown
    segmentIndex?: unknown
    point?: unknown
  }
}

export function ductEndpointPort(duct: DuctSegmentNode, endpoint: DuctEndpoint): ScenePort | null {
  if (duct.path.length < 2) return null
  const index = endpoint === 'start' ? 0 : duct.path.length - 1
  const neighborIndex = endpoint === 'start' ? 1 : duct.path.length - 2
  const position = duct.path[index]!
  const neighbor = duct.path[neighborIndex]!
  const dx = position[0] - neighbor[0]
  const dy = position[1] - neighbor[1]
  const dz = position[2] - neighbor[2]
  const length = Math.hypot(dx, dy, dz)
  return {
    id: endpoint,
    nodeId: duct.id,
    position,
    direction: length < 1e-9 ? [1, 0, 0] : [dx / length, dy / length, dz / length],
    diameter: ductPortDiameterIn(duct),
    system: duct.system,
  }
}

export function ductContinuationHandlePoint(
  duct: DuctSegmentNode,
  endpoint: DuctEndpoint,
  gap = 0.28,
): [number, number, number] | null {
  const port = ductEndpointPort(duct, endpoint)
  if (!port) return null
  return [
    port.position[0] + port.direction[0] * gap,
    port.position[1] + port.direction[1] * gap,
    port.position[2] + port.direction[2] * gap,
  ]
}

export function ductContinuationHandlePlan(
  duct: DuctSegmentNode,
  endpoint: DuctEndpoint,
  nodes: Readonly<Record<string, AnyNode>>,
  gap = 0.28,
): RunContinuationHandlePlan | null {
  const port = ductEndpointPort(duct, endpoint)
  return port ? resolveDuctContinuationHandle(port, nodes, gap) : null
}

export function resolveDuctContinuationSeed(
  defaults: unknown,
  nodes: Record<string, AnyNode>,
): DuctContinuationSeed | null {
  const continuation = (defaults as DuctContinuationDefaults | null)?.continuation
  const endpoint = continuation?.endpoint
  const nodeId = continuation?.nodeId
  if (endpoint === 'branch' && typeof nodeId === 'string') {
    const node = nodes[nodeId as AnyNodeId]
    const segmentIndex = continuation?.segmentIndex
    const point = continuation?.point
    if (
      node?.type === 'duct-segment' &&
      typeof segmentIndex === 'number' &&
      Array.isArray(point) &&
      point.length === 3
    ) {
      return {
        duct: node,
        port: null,
        body: { nodeId: node.id, segmentIndex, point: point as [number, number, number] },
      }
    }
  }
  if (
    (endpoint !== 'start' && endpoint !== 'end') ||
    typeof nodeId !== 'string' ||
    nodeId.length === 0
  )
    return null
  const node = nodes[nodeId as AnyNodeId]
  if (node?.type !== 'duct-segment') return null
  const port = ductEndpointPort(node, endpoint)
  if (!port) return null
  if (typeof continuation?.fittingId !== 'string') return { duct: node, port, body: null }
  const fitting = nodes[continuation.fittingId as AnyNodeId]
  if (fitting?.type !== 'duct-fitting') return null
  const fittingPort = findMatedScenePorts(port, nodes).find((mate) => mate.nodeId === fitting.id)
  if (!fittingPort) return null
  const promotion =
    fitting.fittingType === 'elbow'
      ? planDuctElbowBranchPromotion(fitting, fittingPort.id)
      : planDuctTeeCrossPromotion(fitting)
  return promotion
    ? {
        duct: node,
        port: promotion.continuationPort,
        body: null,
        promotedFitting: promotion.fitting,
      }
    : null
}

export function activateDuctBranch(
  duct: DuctSegmentNode,
  segmentIndex: number,
  point: [number, number, number],
): void {
  const segment = duct.path[segmentIndex]
  const next = duct.path[segmentIndex + 1]
  if (!segment || !next) return
  const editor = useEditor.getState()
  editor.setToolDefaults('duct-segment', {
    continuation: { nodeId: duct.id, endpoint: 'branch', segmentIndex, point },
    shape: duct.shape,
    diameter: duct.diameter,
    width: duct.width,
    height: duct.height,
    ductMaterial: duct.ductMaterial,
    seamDetail: duct.seamDetail,
    insulated: duct.insulated,
    insulationR: duct.insulationR,
    system: duct.system,
  })
  useViewer.getState().setSelection({ selectedIds: [] })
  editor.setTool('duct-segment')
}

export function activateDuctContinuation(
  duct: DuctSegmentNode,
  endpoint: DuctEndpoint,
  fittingId?: AnyNodeId,
): void {
  if (!ductEndpointPort(duct, endpoint)) return
  const editor = useEditor.getState()
  editor.setToolDefaults('duct-segment', {
    continuation: { nodeId: duct.id, endpoint, ...(fittingId ? { fittingId } : {}) },
    shape: duct.shape,
    diameter: duct.diameter,
    width: duct.width,
    height: duct.height,
    ductMaterial: duct.ductMaterial,
    seamDetail: duct.seamDetail,
    insulated: duct.insulated,
    insulationR: duct.insulationR,
    system: duct.system,
  })
  useViewer.getState().setSelection({ selectedIds: [] })
  editor.setTool('duct-segment')
}

export const ductContinuationAffordance: FloorplanAffordance<DuctSegmentNode> = {
  start({ node, payload }) {
    const data = payload as { endpoint?: unknown; fittingId?: unknown } | null
    const endpoint = data?.endpoint
    const fittingId =
      typeof data?.fittingId === 'string' ? (data.fittingId as AnyNodeId) : undefined
    return {
      affectedIds: [],
      apply() {},
      canCommit: () => endpoint === 'start' || endpoint === 'end',
      commit() {
        if (endpoint === 'start' || endpoint === 'end') {
          activateDuctContinuation(node, endpoint, fittingId)
        }
      },
    }
  },
}

export const ductBranchAffordance: FloorplanAffordance<DuctSegmentNode> = {
  start({ node, payload }) {
    const data = payload as { segmentIndex?: unknown; point?: unknown } | null
    const segmentIndex = data?.segmentIndex
    const point = data?.point
    return {
      affectedIds: [],
      apply() {},
      canCommit: () =>
        typeof segmentIndex === 'number' && Array.isArray(point) && point.length === 3,
      commit() {
        if (typeof segmentIndex === 'number' && Array.isArray(point) && point.length === 3) {
          activateDuctBranch(node, segmentIndex, point as [number, number, number])
        }
      },
    }
  },
}

export function currentDuctContinuationSeed(): DuctContinuationSeed | null {
  return resolveDuctContinuationSeed(
    useEditor.getState().toolDefaults['duct-segment'],
    useScene.getState().nodes,
  )
}
