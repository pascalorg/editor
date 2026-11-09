import type { ScenePort } from './ports'

export type PortScreenPoint = { x: number; y: number; depth: number }

export function findScreenPort(
  ports: readonly ScenePort[],
  pointer: readonly [number, number],
  project: (point: ScenePort['position']) => PortScreenPoint | null,
  source: Pick<ScenePort, 'nodeId' | 'id'> | null,
  radius = 16,
): { port: ScenePort; screen: PortScreenPoint } | null {
  let best: { port: ScenePort; screen: PortScreenPoint } | null = null
  let distance = radius
  for (const port of ports) {
    if (source?.nodeId === port.nodeId && source.id === port.id) continue
    const screen = project(port.position)
    if (!screen) continue
    const nextDistance = Math.hypot(screen.x - pointer[0], screen.y - pointer[1])
    if (!Number.isFinite(nextDistance) || nextDistance > distance) continue
    if (best && nextDistance === distance && screen.depth >= best.screen.depth) continue
    best = { port, screen }
    distance = nextDistance
  }
  return best
}
