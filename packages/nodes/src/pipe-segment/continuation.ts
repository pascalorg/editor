import { type AnyNode, type AnyNodeId, type FloorplanAffordance, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import type { PipeFittingNode } from '../pipe-fitting/schema'
import {
  findMatedScenePorts,
  planPipeElbowBranchPromotion,
  planPipeTeeCrossPromotion,
  type RunContinuationHandlePlan,
  resolvePipeContinuationHandle,
} from '../shared/elbow-branch-continuation'
import type { RunBodyHit, ScenePort } from '../shared/ports'
import type { PipeSegmentNode } from './schema'

export type PipeEndpoint = 'start' | 'end'

export type PipeContinuationSeed = {
  pipe: PipeSegmentNode
  port: ScenePort | null
  body: RunBodyHit | null
  promotedFitting?: PipeFittingNode
}

type PipeContinuationDefaults = {
  continuation?: {
    nodeId?: unknown
    endpoint?: unknown
    fittingId?: unknown
    segmentIndex?: unknown
    point?: unknown
  }
}

export function pipeEndpointPort(pipe: PipeSegmentNode, endpoint: PipeEndpoint): ScenePort | null {
  if (pipe.path.length < 2) return null
  const index = endpoint === 'start' ? 0 : pipe.path.length - 1
  const neighborIndex = endpoint === 'start' ? 1 : pipe.path.length - 2
  const position = pipe.path[index]!
  const neighbor = pipe.path[neighborIndex]!
  const dx = position[0] - neighbor[0]
  const dy = position[1] - neighbor[1]
  const dz = position[2] - neighbor[2]
  const length = Math.hypot(dx, dy, dz)
  return {
    id: endpoint,
    nodeId: pipe.id,
    position,
    direction: length < 1e-9 ? [1, 0, 0] : [dx / length, dy / length, dz / length],
    diameter: pipe.diameter,
    system: pipe.system,
  }
}

export function pipeContinuationHandlePoint(
  pipe: PipeSegmentNode,
  endpoint: PipeEndpoint,
  gap = 0.28,
): [number, number, number] | null {
  const port = pipeEndpointPort(pipe, endpoint)
  if (!port) return null
  return [
    port.position[0] + port.direction[0] * gap,
    port.position[1] + port.direction[1] * gap,
    port.position[2] + port.direction[2] * gap,
  ]
}

export function pipeContinuationHandlePlan(
  pipe: PipeSegmentNode,
  endpoint: PipeEndpoint,
  nodes: Readonly<Record<string, AnyNode>>,
  gap = 0.28,
): RunContinuationHandlePlan | null {
  const port = pipeEndpointPort(pipe, endpoint)
  return port ? resolvePipeContinuationHandle(port, nodes, gap) : null
}

export function resolvePipeContinuationSeed(
  defaults: unknown,
  nodes: Record<string, AnyNode>,
): PipeContinuationSeed | null {
  const continuation = (defaults as PipeContinuationDefaults | null)?.continuation
  const endpoint = continuation?.endpoint
  const nodeId = continuation?.nodeId
  if (endpoint === 'branch' && typeof nodeId === 'string') {
    const node = nodes[nodeId as AnyNodeId]
    const segmentIndex = continuation?.segmentIndex
    const point = continuation?.point
    if (
      node?.type === 'pipe-segment' &&
      typeof segmentIndex === 'number' &&
      Array.isArray(point) &&
      point.length === 3
    ) {
      return {
        pipe: node,
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
  if (node?.type !== 'pipe-segment') return null
  const port = pipeEndpointPort(node, endpoint)
  if (!port) return null
  if (typeof continuation?.fittingId !== 'string') return { pipe: node, port, body: null }
  const fitting = nodes[continuation.fittingId as AnyNodeId]
  if (fitting?.type !== 'pipe-fitting') return null
  const fittingPort = findMatedScenePorts(port, nodes).find((mate) => mate.nodeId === fitting.id)
  if (!fittingPort) return null
  const promotion =
    fitting.fittingType === 'elbow'
      ? planPipeElbowBranchPromotion(fitting, fittingPort.id)
      : planPipeTeeCrossPromotion(fitting)
  return promotion
    ? {
        pipe: node,
        port: promotion.continuationPort,
        body: null,
        promotedFitting: promotion.fitting,
      }
    : null
}

export function activatePipeBranch(
  pipe: PipeSegmentNode,
  segmentIndex: number,
  point: [number, number, number],
): void {
  if (!pipe.path[segmentIndex] || !pipe.path[segmentIndex + 1]) return
  const editor = useEditor.getState()
  editor.setToolDefaults('pipe-segment', {
    continuation: { nodeId: pipe.id, endpoint: 'branch', segmentIndex, point },
  })
  useViewer.getState().setSelection({ selectedIds: [] })
  editor.setTool('pipe-segment')
}

export function activatePipeContinuation(
  pipe: PipeSegmentNode,
  endpoint: PipeEndpoint,
  fittingId?: AnyNodeId,
): void {
  if (!pipeEndpointPort(pipe, endpoint)) return
  const editor = useEditor.getState()
  editor.setToolDefaults('pipe-segment', {
    continuation: { nodeId: pipe.id, endpoint, ...(fittingId ? { fittingId } : {}) },
  })
  useViewer.getState().setSelection({ selectedIds: [] })
  editor.setTool('pipe-segment')
}

export const pipeContinuationAffordance: FloorplanAffordance<PipeSegmentNode> = {
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
          activatePipeContinuation(node, endpoint, fittingId)
        }
      },
    }
  },
}

export const pipeBranchAffordance: FloorplanAffordance<PipeSegmentNode> = {
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
          activatePipeBranch(node, segmentIndex, point as [number, number, number])
        }
      },
    }
  },
}

export function currentPipeContinuationSeed(): PipeContinuationSeed | null {
  return resolvePipeContinuationSeed(
    useEditor.getState().toolDefaults['pipe-segment'],
    useScene.getState().nodes,
  )
}
