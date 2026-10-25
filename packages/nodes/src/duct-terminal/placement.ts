import { connectionCompatibility, type NodePort, portConnection } from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'
import { COLLAR_LENGTH, getDuctTerminalPorts, mountQuaternion } from './ports'
import { DuctTerminalNode } from './schema'

export function resolveTerminalPortPlacement(
  node: DuctTerminalNode,
  position: [number, number, number],
  yaw: number,
  ports: readonly NodePort[],
) {
  const profile = getDuctTerminalPorts(node)[0]!
  let best: {
    position: [number, number, number]
    yaw: number
    mount: DuctTerminalNode['mount']
  } | null = null
  let distance = 0.5
  for (const port of ports) {
    const nextDistance = Math.hypot(...port.position.map((value, i) => value - position[i]!))
    if (nextDistance > distance || connectionCompatibility(profile, port).status !== 'match')
      continue
    const dir = new Vector3(...port.direction).normalize()
    const mount: DuctTerminalNode['mount'] =
      dir.y > 0.7 ? 'floor' : dir.y < -0.7 ? 'ceiling' : 'wall'
    const rotation = mount === 'wall' ? Math.atan2(dir.x, dir.z) : yaw
    const transform = new Quaternion()
      .setFromEuler(new Euler(0, rotation, 0))
      .multiply(mountQuaternion(mount))
    const offset = new Vector3(0, -COLLAR_LENGTH, 0).applyQuaternion(transform)
    const placed = {
      position: [
        port.position[0] - offset.x,
        port.position[1] - offset.y,
        port.position[2] - offset.z,
      ] as [number, number, number],
      yaw: rotation,
      mount,
    }
    const collar = getDuctTerminalPorts({ ...node, ...placed, rotation })[0]!
    if (portConnection(collar, port).status !== 'match') continue
    best = placed
    distance = nextDistance
  }
  return best
}

/** Explicitly adopt a nearby air port's profile; never silently switch the terminal's system. */
export function terminalProfileForPort(
  node: DuctTerminalNode,
  port: NodePort,
): Partial<DuctTerminalNode> | null {
  if (port.system !== 'supply' && port.system !== 'return') return null
  if (port.shape && port.shape !== 'round' && (!port.width || !port.height)) return null
  const patch = {
    terminalType:
      port.system === 'return'
        ? ('return-grille' as const)
        : node.terminalType === 'return-grille'
          ? ('supply-register' as const)
          : node.terminalType,
    collarShape: port.shape ?? 'round',
    ...(port.shape && port.shape !== 'round'
      ? { collarWidth: port.width, collarHeight: port.height }
      : { collarDiameter: port.diameter }),
  }
  return DuctTerminalNode.safeParse({ ...node, ...patch }).success ? patch : null
}
