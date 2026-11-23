import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanAffordance,
  type NodePort,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import type { RunBodyHit, ScenePort } from '@pascal-app/editor/distribution'
import { useViewer } from '@pascal-app/viewer'
import type { PipeFittingNode } from '../pipe-fitting/schema'
import {
  findMatedScenePorts,
  planPipeElbowBranchPromotion,
  planPipeTeeCrossPromotion,
} from '../shared/elbow-branch-continuation'
import { pipeCollar, pipeCollarOccupied } from './collar-connection'
import { type PipeEndpoint, pipeEndpointPort } from './continuation-handle'
import { PipeSegmentNode } from './schema'
import { pipeGrade } from './slope'

export type PipeContinuationSeed = {
  pipe: PipeSegmentNode
  port: ScenePort | null
  body: RunBodyHit | null
  promotedFitting?: PipeFittingNode
}

type PipeContinuationDefaults = {
  continuation?: {
    nodeId?: unknown
    portId?: unknown
    endpoint?: unknown
    fittingId?: unknown
    segmentIndex?: unknown
    point?: unknown
  }
}

export function resolvePipeContinuationSeed(
  defaults: unknown,
  nodes: Record<string, AnyNode>,
): PipeContinuationSeed | null {
  const continuation = (defaults as PipeContinuationDefaults | null)?.continuation
  if (typeof continuation?.nodeId === 'string' && typeof continuation.portId === 'string') {
    const source = nodes[continuation.nodeId]
    const port = pipeCollar(nodes, continuation.nodeId, continuation.portId)
    if (!source || !port || pipeCollarOccupied(nodes, port)) return null
    const profile = PipeSegmentNode.safeParse({
      parentId: source.parentId,
      diameter: port.diameter,
      system: port.system,
      pipeMaterial: 'pipeMaterial' in source ? source.pipeMaterial : 'pvc',
      path: [[...port.position], port.position.map((value, i) => value + port.direction[i]!)],
    })
    return profile.success ? { pipe: profile.data, port, body: null } : null
  }
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
  if (fitting.fittingType === 'end-cap') return { pipe: node, port, body: null }
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
    ...editor.toolDefaults['pipe-segment'],
    routingMode: 'surface',
    crossingMode: 'connect',
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
    ...editor.toolDefaults['pipe-segment'],
    routingMode: 'surface',
    crossingMode: 'connect',
    continuation: { nodeId: pipe.id, endpoint, ...(fittingId ? { fittingId } : {}) },
    ...(() => {
      const a = endpoint === 'end' ? pipe.path.at(-2)! : pipe.path[1]!
      const b = endpoint === 'end' ? pipe.path.at(-1)! : pipe.path[0]!
      const grade = pipeGrade(a, b)
      return grade === null
        ? { fall: 'level' }
        : {
            fall: Math.abs(grade) > 1e-6 ? 'sloped' : 'level',
            gradePercent: Math.abs(grade) * 100,
            flowDirection: grade < 0 ? 'reverse' : 'forward',
          }
    })(),
  })
  useViewer.getState().setSelection({ selectedIds: [] })
  editor.setTool('pipe-segment')
}

export function activatePipeCollarContinuation(node: AnyNode, port: NodePort): void {
  const editor = useEditor.getState()
  editor.setToolDefaults('pipe-segment', {
    ...editor.toolDefaults['pipe-segment'],
    continuation: { nodeId: node.id, portId: port.id },
    diameter: port.diameter,
    system: port.system,
    pipeMaterial: 'pipeMaterial' in node ? node.pipeMaterial : 'pvc',
    elevation: port.position[1],
    routingMode:
      Math.hypot(port.direction[0], port.direction[2]) < 1e-6 ? 'vertical' : 'horizontal',
    targetElevation: port.position[1] + Math.sign(port.direction[1] || 1),
    ...(() => {
      const grade = pipeGrade([0, 0, 0], [...port.direction]) ?? 0
      return {
        fall: Math.abs(grade) > 1e-6 ? 'sloped' : 'level',
        gradePercent: Math.abs(grade) * 100,
        flowDirection: grade < 0 ? 'reverse' : 'forward',
      }
    })(),
    crossingMode: 'connect',
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
