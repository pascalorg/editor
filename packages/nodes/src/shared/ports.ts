import { type AnyNodeId, type NodePort, nodeRegistry, useScene } from '@pascal-app/core'

/** A port plus the scene node that owns it. */
export type ScenePort = NodePort & { nodeId: AnyNodeId }

/** Air-loop port systems — what duct runs and fittings snap to. */
export const DUCT_PORT_SYSTEMS = ['supply', 'return'] as const
/** DWV port systems — what drain / waste / vent pipe runs snap to. */
export const DWV_PORT_SYSTEMS = ['waste', 'vent'] as const
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

// ─── Run-body hits ───────────────────────────────────────────────────

/** Closest-point hit on a duct run's centerline (not its end ports). */
export type RunBodyHit = {
  nodeId: AnyNodeId
  /** Polyline segment hit — between `path[segmentIndex]` and `path[segmentIndex + 1]`. */
  segmentIndex: number
  /** Closest point on the centerline, level-local meters (Y interpolated). */
  point: [number, number, number]
}

/**
 * Nearest point on any duct-segment CENTERLINE within `radius` of `point`
 * on the XZ plane — how a branch taps the side of a trunk. Same XZ-only
 * distance convention as `findNearestPortXZ` (grid events ride the floor,
 * runs hang at duct height); the hit adopts the centerline's full 3D
 * position. Vertical risers project to a point in XZ and are skipped —
 * tapping those isn't meaningful.
 */
export function findNearestRunBodyXZ(
  point: readonly [number, number, number],
  radius: number,
  excludeNodeId?: AnyNodeId,
): RunBodyHit | null {
  const { nodes } = useScene.getState()
  let best: RunBodyHit | null = null
  let bestDistSq = radius * radius
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== 'duct-segment' || node.id === excludeNodeId) continue
    const path = node.path
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!
      const b = path[i + 1]!
      const abx = b[0] - a[0]
      const abz = b[2] - a[2]
      const lenSq = abx * abx + abz * abz
      if (lenSq < 1e-8) continue // vertical riser — no XZ extent
      const t = Math.min(
        1,
        Math.max(0, ((point[0] - a[0]) * abx + (point[2] - a[2]) * abz) / lenSq),
      )
      const cx = a[0] + abx * t
      const cz = a[2] + abz * t
      const dx = point[0] - cx
      const dz = point[2] - cz
      const distSq = dx * dx + dz * dz
      if (distSq <= bestDistSq) {
        bestDistSq = distSq
        best = {
          nodeId: node.id,
          segmentIndex: i,
          point: [cx, a[1] + (b[1] - a[1]) * t, cz],
        }
      }
    }
  }
  return best
}
