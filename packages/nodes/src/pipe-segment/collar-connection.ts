import { type AnyNode, nodeRegistry, PipeFittingNode } from '@pascal-app/core'
import { refuse } from '@pascal-app/core/agent-tools'
import type { ScenePort } from '@pascal-app/editor/distribution'
import { Euler, Quaternion, Vector3 } from 'three'
import { pipeFittingLegLength } from '../pipe-fitting/ports'

type Point = [number, number, number]
export function pipeCollar(
  nodes: Readonly<Record<string, AnyNode>>,
  nodeId: string,
  portId: string,
): ScenePort | null {
  const node = nodes[nodeId]
  const port =
    node &&
    nodeRegistry
      .get(node.type)
      ?.ports?.(node)
      .find((port) => port.id === portId)
  return port && (port.system === 'waste' || port.system === 'vent')
    ? { ...port, nodeId: node.id }
    : null
}
export function pipeCollarOccupied(
  nodes: Readonly<Record<string, AnyNode>>,
  port: ScenePort,
): boolean {
  const owner = nodes[port.nodeId]
  return Object.values(nodes).some(
    (node) =>
      node.id !== port.nodeId &&
      node.parentId === owner?.parentId &&
      (nodeRegistry.get(node.type)?.ports?.(node) ?? []).some(
        (other) =>
          other.system === port.system &&
          new Vector3(...other.position).distanceTo(new Vector3(...port.position)) < 0.005,
      ),
  )
}

/** Fixed collars cannot be trimmed like pipe endpoints; leave straight along their axis. */
export function planPipeCollarConnection(
  nodes: Readonly<Record<string, AnyNode>>,
  source: ScenePort,
  toward: Point,
  diameter: number,
  system: string,
  material: PipeFittingNode['pipeMaterial'],
) {
  const port = pipeCollar(nodes, source.nodeId, source.id)
  if (!port || new Vector3(...port.position).distanceTo(new Vector3(...source.position)) > 1e-6)
    return refuse(
      'pipe_collar_changed',
      'The connection moved or disappeared. Select the collar again.',
    )
  if (port.system !== system)
    return refuse('pipe_collar_system', 'Use the same waste or vent system as the collar.')
  if (pipeCollarOccupied(nodes, port))
    return refuse('pipe_collar_occupied', 'This collar is already connected.')
  const axis = new Vector3(...port.direction).normalize()
  const travel = new Vector3(...toward).sub(new Vector3(...port.position))
  if (travel.length() < 0.05 || axis.dot(travel.clone().normalize()) < 0.999999)
    return refuse(
      'pipe_collar_direction',
      'Draw the first section straight out of the collar, then add a bend from the new pipe endpoint.',
    )
  if (diameter === port.diameter)
    return { point: [...port.position] as Point, fittings: [] as PipeFittingNode[] }
  const leg = pipeFittingLegLength(Math.max(diameter, port.diameter))
  if (travel.length() < 2 * leg + 0.05)
    return refuse('pipe_collar_space', 'Lengthen the pipe to leave room for the reducer.')
  const rotation = new Euler().setFromQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), axis),
  )
  const fitting = PipeFittingNode.parse({
    parentId: nodes[source.nodeId]!.parentId,
    fittingType: 'reducer',
    diameter: port.diameter,
    diameter2: diameter,
    system: port.system,
    pipeMaterial: material,
    position: new Vector3(...port.position).addScaledVector(axis, leg).toArray(),
    rotation: [rotation.x, rotation.y, rotation.z],
  })
  return {
    point: new Vector3(...port.position).addScaledVector(axis, 2 * leg).toArray() as Point,
    fittings: [fitting],
  }
}
