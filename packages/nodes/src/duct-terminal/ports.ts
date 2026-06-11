import type { NodePort } from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'
import type { DuctTerminalNode } from './schema'

/** Collar stub length in meters behind the face. */
export const COLLAR_LENGTH = 0.12

/**
 * Mount orientation: rotation applied to the canonical floor frame
 * (face normal +Y, collar pointing -Y). Ceiling flips it; wall stands
 * it up so the face looks along +Z and the collar points -Z (into the
 * wall). Yaw is applied on top by the renderer / port transform.
 */
export function mountQuaternion(mount: DuctTerminalNode['mount']): Quaternion {
  if (mount === 'ceiling') return new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0))
  if (mount === 'wall') return new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0))
  return new Quaternion()
}

export function terminalSystem(node: DuctTerminalNode): 'supply' | 'return' {
  return node.terminalType === 'return-grille' ? 'return' : 'supply'
}

/**
 * `def.ports` — the single collar port in level-local space. Canonical
 * frame: collar tip at (0, -COLLAR_LENGTH, 0) pointing -Y (away from the
 * face); mount + yaw + position transform it. Direction points OUT of
 * the terminal — i.e. toward the duct that should connect.
 */
export function getDuctTerminalPorts(node: DuctTerminalNode): NodePort[] {
  const transform = new Quaternion()
    .setFromEuler(new Euler(0, node.rotation, 0))
    .multiply(mountQuaternion(node.mount))
  const position = new Vector3(0, -COLLAR_LENGTH, 0)
    .applyQuaternion(transform)
    .add(new Vector3(node.position[0], node.position[1], node.position[2]))
  const direction = new Vector3(0, -1, 0).applyQuaternion(transform).normalize()
  return [
    {
      id: 'collar',
      position: [position.x, position.y, position.z] as const,
      direction: [direction.x, direction.y, direction.z] as const,
      diameter: node.collarDiameter,
      system: terminalSystem(node),
    },
  ]
}
