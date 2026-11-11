import type { AnyNode } from '@pascal-app/core'
import type { ScenePort } from '@pascal-app/editor/distribution'
import {
  type RunContinuationHandlePlan,
  resolvePipeContinuationHandle,
} from '../shared/elbow-branch-continuation'
import type { PipeSegmentNode } from './schema'

export type PipeEndpoint = 'start' | 'end'

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
