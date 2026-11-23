import type { AnyNode, DuctSegmentNode } from '@pascal-app/core'
import type { ScenePort } from '@pascal-app/editor/distribution'
import {
  type RunContinuationHandlePlan,
  resolveDuctContinuationHandle,
} from '../shared/elbow-branch-continuation'
import { ductPortDiameterIn } from './profile'

export type DuctEndpoint = 'start' | 'end'

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
