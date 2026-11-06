import { type AnyNode, nodeRegistry, PipeFittingNode, PipeSegmentNode } from '@pascal-app/core'
import type { AgentOperation, SceneChanges } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import type { ScenePort } from '@pascal-app/editor/distribution'
import { Euler, Quaternion, Vector3 } from 'three'
import { pipeFittingLegLength } from '../pipe-fitting/ports'
import { pipeGradesMatch } from './slope'

type Point = [number, number, number]
export type PipeResizeInput = { nodeId: string; diameter: number; scope?: 'segment' | 'branch' }
const portsOf = (node: AnyNode): ScenePort[] =>
  nodeRegistry
    .get(node.type)
    ?.ports?.(node)
    .map((port) => ({ ...port, nodeId: node.id })) ?? []
const vector = (point: readonly [number, number, number]) => new Vector3(...point)

export const resizePipe: AgentOperation<PipeResizeInput> = (nodes, input) => {
  const root = nodes[input.nodeId]
  if (root?.type !== 'pipe-segment') return refuse('pipe_not_found', 'Select a pipe run.')
  if (!nodeRegistry.get('pipe-segment')?.ports || !nodeRegistry.get('pipe-fitting')?.ports)
    return refuse(
      'node_capability_unavailable',
      'Register pipe and fitting definitions before resizing.',
    )
  if (!PipeSegmentNode.safeParse({ ...root, diameter: input.diameter }).success)
    return refuse('pipe_size_invalid', 'Enter a pipe diameter between 1.25 and 8 inches.')
  const ports = Object.values(nodes)
    .filter((node) => node.parentId === root.parentId)
    .flatMap(portsOf)
  const mates = (port: ScenePort) =>
    ports.filter(
      (other) =>
        other.nodeId !== port.nodeId &&
        other.system === port.system &&
        vector(other.position).distanceTo(vector(port.position)) < 0.005,
    )
  const mateOf = (port: ScenePort) => {
    const found = mates(port)
    if (found.length > 1)
      return refuse('pipe_ambiguous_connection', 'Resolve overlapping connections before resizing.')
    const mate = found[0]
    if (mate && vector(mate.direction).dot(vector(port.direction)) > -0.999999)
      return refuse('pipe_connection_angle', 'Align the connected collars before resizing.')
    return mate
  }
  const selected = new Set<string>([root.id])
  const queue: AnyNode[] = [root]
  for (const node of queue) {
    for (const port of portsOf(node)) {
      const mate = mateOf(port)
      if (!mate || selected.has(mate.nodeId)) continue
      const owner = nodes[mate.nodeId]!
      const cap = owner.type === 'pipe-fitting' && owner.fittingType === 'end-cap'
      const sameSize = 'diameter' in owner && owner.diameter === root.diameter
      const sameMaterial = 'pipeMaterial' in owner && owner.pipeMaterial === root.pipeMaterial
      const throughFitting =
        owner.type === 'pipe-fitting' &&
        ['elbow', 'coupling', 'cleanout'].includes(owner.fittingType) &&
        portsOf(owner).every((collar) =>
          mates(collar).every((neighbor) => {
            const run = nodes[neighbor.nodeId]
            return (
              run?.type === 'pipe-segment' &&
              run.diameter === root.diameter &&
              run.pipeMaterial === root.pipeMaterial
            )
          }),
        )
      if (
        sameSize &&
        (cap ||
          (input.scope === 'branch' &&
            sameMaterial &&
            (owner.type === 'pipe-segment' || throughFitting)))
      ) {
        selected.add(owner.id)
        queue.push(owner)
      }
    }
  }
  if (input.diameter === root.diameter)
    return { result: { message: 'The branch already has this diameter.' } }
  const changed = new Map<string, AnyNode>()
  for (const node of queue) {
    if (node.type === 'pipe-segment')
      changed.set(node.id, {
        ...node,
        diameter: input.diameter,
        path: node.path.map((p) => [...p]),
        wallAttachment: undefined,
      })
    else if (node.type === 'pipe-fitting') {
      const next = PipeFittingNode.parse({
        ...node,
        diameter: input.diameter,
        diameter2: input.diameter,
      })
      if (portsOf(node).length === 1) {
        // Keep a cap's inlet fixed while its body grows away from the run.
        const delta = vector(portsOf(node)[0]!.position).sub(vector(portsOf(next)[0]!.position))
        next.position = vector(next.position).add(delta).toArray()
      }
      changed.set(node.id, next)
    }
  }
  const create: NonNullable<SceneChanges['create']> = []
  for (const node of queue) {
    if (node.type !== 'pipe-segment') continue
    const next = changed.get(node.id) as PipeSegmentNode
    for (const port of portsOf(node)) {
      const mate = mateOf(port)
      if (!mate) continue
      const index = port.id === 'start' ? 0 : next.path.length - 1
      if (selected.has(mate.nodeId)) {
        const updatedMate = portsOf(changed.get(mate.nodeId)!).find((p) => p.id === mate.id)!
        // Adjacent runs keep their shared point; only fitting collars move.
        if (
          nodes[mate.nodeId]?.type === 'pipe-fitting' &&
          portsOf(changed.get(mate.nodeId)!).length > 1
        )
          next.path[index] = [...updatedMate.position]
        continue
      }
      if (mate.diameter === input.diameter) continue
      const axis = vector(mate.direction).normalize()
      const leg = pipeFittingLegLength(Math.max(mate.diameter, input.diameter))
      const rotation = new Euler().setFromQuaternion(
        new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), axis),
      )
      const fitting = PipeFittingNode.parse({
        parentId: root.parentId,
        fittingType: 'reducer',
        system: root.system,
        pipeMaterial: root.pipeMaterial,
        diameter: mate.diameter,
        diameter2: input.diameter,
        position: vector(mate.position).addScaledVector(axis, leg).toArray(),
        rotation: [rotation.x, rotation.y, rotation.z],
      })
      create.push({ node: fitting, parentId: root.parentId! })
      next.path[index] = [...portsOf(fitting).find((p) => p.id === 'outlet')!.position]
    }
    for (let i = 1; i < next.path.length; i++) {
      const before = vector(node.path[i]!)
        .sub(vector(node.path[i - 1]!))
        .normalize()
      const after = vector(next.path[i]!).sub(vector(next.path[i - 1]!))
      if (after.length() < 0.001 || before.dot(after.clone().normalize()) < 0.999999)
        return refuse(
          'pipe_resize_space',
          'Not enough straight pipe for the new fittings. Extend the route first.',
        )
    }
    if (!pipeGradesMatch(node.path, next.path as Point[]))
      return refuse(
        'pipe_resize_grade',
        'This resize would change the pipe grade. Adjust the fitting layout first.',
      )
  }
  return {
    result: {
      message: 'Pipe sizes updated; grades and boundary connections preserved.',
      runs: queue.filter((n) => n.type === 'pipe-segment').length,
      fittings: queue.filter((n) => n.type === 'pipe-fitting').length,
      reducers: create.length,
    },
    changes: { create, update: [...changed].map(([id, node]) => ({ id, data: node })) },
  }
}
