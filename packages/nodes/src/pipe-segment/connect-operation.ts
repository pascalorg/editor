import { nodeRegistry, PipeSegmentNode } from '@pascal-app/core'
import type { AgentOperation } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import { createPipeRunEndCap } from '../shared/automatic-run-end-cap'
import { pipeCollar, planPipeCollarConnection } from './collar-connection'

export type PipeConnectInput = {
  nodeId: string
  portId: string
  end: [number, number, number]
  diameter?: number
}
export const connectPipe: AgentOperation<PipeConnectInput> = (nodes, input) => {
  const owner = nodes[input.nodeId]
  const port = pipeCollar(nodes, input.nodeId, input.portId)
  if (!owner || !port || owner.type === 'pipe-segment')
    return refuse('pipe_collar_missing', 'Choose a fixture, trap or fitting waste/vent collar.')
  if (!input.end.every(Number.isFinite))
    return refuse('pipe_endpoint_invalid', 'Enter a finite endpoint.')
  const diameter = input.diameter ?? port.diameter
  const parsed = PipeSegmentNode.safeParse({
    parentId: owner.parentId,
    path: [[...port.position], input.end],
    diameter,
    system: port.system,
    pipeMaterial: 'pipeMaterial' in owner ? owner.pipeMaterial : 'pvc',
  })
  if (!parsed.success)
    return refuse('pipe_size_invalid', 'Use a supported pipe diameter between 1.25 and 8 inches.')
  const pipe = parsed.data
  const plan = planPipeCollarConnection(
    nodes,
    port,
    input.end,
    diameter,
    pipe.system,
    pipe.pipeMaterial,
  )
  // An endpoint at another collar must use the draw tool's two-ended connection planning.
  if (
    Object.values(nodes).some(
      (node) =>
        node.parentId === owner.parentId &&
        (nodeRegistry.get(node.type)?.ports?.(node) ?? []).some(
          (other) =>
            other.system === port.system &&
            Math.hypot(...other.position.map((v, i) => v - input.end[i]!)) < 0.005,
        ),
    )
  )
    return refuse(
      'pipe_endpoint_occupied',
      'Choose a free endpoint; use pipe drawing to join an existing collar.',
    )
  pipe.path = [plan.point, input.end]
  const cap = createPipeRunEndCap(pipe)!
  return {
    result: {
      message: 'Pipe connected; source collar remains fixed.',
      pipeId: pipe.id,
      reducers: plan.fittings.length,
    },
    changes: {
      create: [pipe, ...plan.fittings, cap].map((node) => ({
        node,
        parentId: owner.parentId ?? undefined,
      })),
    },
  }
}
