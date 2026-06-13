import type { NodePort } from '@pascal-app/core'
import { Vector3 } from 'three'
import { localTrapPorts } from './geometry'
import type { PipeTrapNode } from './schema'

/**
 * `def.ports` — the trap's inlet (up, to the fixture) and outlet (the
 * trap arm, toward the vented waste line), transformed by position +
 * yaw into level-local space. Both carry the trap diameter and the
 * 'waste' system tag so the pipe tool and system graph treat them like
 * any other DWV joint.
 */
export function getPipeTrapPorts(node: PipeTrapNode): NodePort[] {
  const { inlet, outlet } = localTrapPorts(node)
  const yaw = node.rotation
  const offset = new Vector3(node.position[0], node.position[1], node.position[2])
  const place = (local: Vector3, dir: Vector3): NodePort => {
    const position = local
      .clone()
      .applyAxisAngle(new Vector3(0, 1, 0), yaw)
      .add(offset)
    const direction = dir
      .clone()
      .applyAxisAngle(new Vector3(0, 1, 0), yaw)
      .normalize()
    return {
      id: local === inlet ? 'inlet' : 'outlet',
      position: [position.x, position.y, position.z] as const,
      direction: [direction.x, direction.y, direction.z] as const,
      diameter: node.diameter,
      system: 'waste',
    }
  }
  return [place(inlet, new Vector3(0, 1, 0)), place(outlet, new Vector3(1, 0, 0))]
}
