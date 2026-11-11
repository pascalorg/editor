import {
  type AnyNode,
  type AnyNodeId,
  type DuctFittingNode,
  DuctSegmentNode,
  type FloorplanAffordance,
  type NodePort,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import type { RunBodyHit, ScenePort } from '@pascal-app/editor/distribution'
import { useViewer } from '@pascal-app/viewer'
import {
  findMatedScenePorts,
  planDuctElbowBranchPromotion,
  planDuctTeeCrossPromotion,
} from '../shared/elbow-branch-continuation'
import { type DuctEndpoint, ductEndpointPort } from './continuation-handle'

export type DuctContinuationSeed = {
  duct: DuctSegmentNode
  port: ScenePort | null
  body: RunBodyHit | null
  promotedFitting?: DuctFittingNode
}

type DuctContinuationDefaults = {
  continuation?: {
    nodeId?: unknown
    portId?: unknown
    endpoint?: unknown
    fittingId?: unknown
    segmentIndex?: unknown
    point?: unknown
  }
}

export function resolveDuctContinuationSeed(
  defaults: unknown,
  nodes: Record<string, AnyNode>,
): DuctContinuationSeed | null {
  const continuation = (defaults as DuctContinuationDefaults | null)?.continuation
  if (typeof continuation?.portId === 'string' && typeof continuation.nodeId === 'string') {
    const source = nodes[continuation.nodeId]
    const port =
      source &&
      nodeRegistry
        .get(source.type)
        ?.ports?.(source)
        .find((p) => p.id === continuation.portId)
    if (!port || (port.system !== 'supply' && port.system !== 'return')) return null
    return {
      duct: DuctSegmentNode.parse({
        parentId: source.parentId,
        path: [
          [...port.position],
          port.position.map((value, index) => value + port.direction[index]!),
        ],
        shape: port.shape ?? 'round',
        diameter: port.diameter,
        width: port.width ?? 14,
        height: port.height ?? 8,
        system: port.system,
      }),
      port: { ...port, nodeId: source.id },
      body: null,
    }
  }
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
  if (fitting.fittingType === 'end-cap') return { duct: node, port, body: null }
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
    ...editor.toolDefaults['duct-segment'],
    routingMode: 'surface',
    crossingMode: 'connect',
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
    ...editor.toolDefaults['duct-segment'],
    routingMode: 'surface',
    crossingMode: 'connect',
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

export function activateDuctCollarContinuation(node: AnyNode, port: NodePort): void {
  const editor = useEditor.getState()
  editor.setToolDefaults('duct-segment', {
    ...editor.toolDefaults['duct-segment'],
    continuation: { nodeId: node.id, portId: port.id },
    shape: port.shape ?? 'round',
    diameter: port.diameter,
    width: port.width ?? 14,
    height: port.height ?? 8,
    system: port.system,
    ductMaterial: 'sheet-metal',
    elevation: port.position[1],
    routingMode:
      Math.hypot(port.direction[0], port.direction[2]) < 1e-6 ? 'vertical' : 'horizontal',
    targetElevation: port.position[1] + Math.sign(port.direction[1] || 1),
    crossingMode: 'connect',
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
