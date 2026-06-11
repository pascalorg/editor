import { type AnyNodeId, type NodePort, nodeRegistry, useScene } from '@pascal-app/core'

/** A port plus the scene node that owns it. */
export type ScenePort = NodePort & { nodeId: AnyNodeId }

/** Air-loop port systems — what duct runs and fittings snap to. */
export const DUCT_PORT_SYSTEMS = ['supply', 'return'] as const
/** Refrigerant-loop port system — what linesets snap to. */
export const REFRIGERANT_PORT_SYSTEMS = ['refrigerant'] as const

/**
 * Filter narrowing which ports a tool will snap to.
 *   - `excludeNodeId` skips the node currently being drawn/placed so a
 *     tool doesn't snap to its own preview.
 *   - `systems` keeps only ports on the listed distribution loops — duct
 *     tools pass the air loops so they ignore refrigerant service ports;
 *     the lineset tool passes `'refrigerant'` so it ignores duct collars.
 *     A port with no `system` matches any filter.
 */
export type PortFilter = {
  excludeNodeId?: AnyNodeId
  systems?: readonly string[]
}

/**
 * Gather every typed port in the scene by asking each node's registered
 * `def.ports`. Positions are level-local meters (the kind applies its own
 * transform inside `def.ports`).
 */
export function collectScenePorts(filter: PortFilter = {}): ScenePort[] {
  const { excludeNodeId, systems } = filter
  const { nodes } = useScene.getState()
  const result: ScenePort[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.id === excludeNodeId) continue
    const ports = nodeRegistry.get(node.type)?.ports?.(node)
    if (!ports) continue
    for (const port of ports) {
      if (systems && port.system !== undefined && !systems.includes(port.system)) continue
      result.push({ ...port, nodeId: node.id })
    }
  }
  return result
}

/**
 * Nearest port within `radius` of `point` on the XZ plane. Y is ignored —
 * grid events ride the floor plane while ports usually hang at duct
 * height, so a vertical-distance check would make elevated ports
 * unreachable. The snap adopts the port's full 3D position.
 */
export function findNearestPortXZ(
  point: readonly [number, number, number],
  ports: ScenePort[],
  radius: number,
): ScenePort | null {
  let best: ScenePort | null = null
  let bestDistSq = radius * radius
  for (const port of ports) {
    const dx = port.position[0] - point[0]
    const dz = port.position[2] - point[2]
    const distSq = dx * dx + dz * dz
    if (distSq <= bestDistSq) {
      bestDistSq = distSq
      best = port
    }
  }
  return best
}
