import {
  type AnyNodeId,
  findLevelAncestorId,
  type NodePort,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import type { RunSurfaceTarget } from './distribution-run-contract'

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
  levelId?: AnyNodeId
  excludeNodeId?: AnyNodeId
  systems?: readonly string[]
}

/**
 * Gather every typed port in the scene by asking each node's registered
 * `def.ports`. Positions are level-local meters (the kind applies its own
 * transform inside `def.ports`).
 */
export function collectScenePorts(filter: PortFilter = {}): ScenePort[] {
  const { excludeNodeId, systems, levelId } = filter
  const { nodes } = useScene.getState()
  const result: ScenePort[] = []
  for (const node of Object.values(nodes)) {
    if (
      !node ||
      node.visible === false ||
      node.id === excludeNodeId ||
      (levelId && findLevelAncestorId(node.id, nodes) !== levelId)
    )
      continue
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

/** Nearest port using true 3D distance. Use this while drafting on a wall. */
export function findNearestPort3D(
  point: readonly [number, number, number],
  ports: ScenePort[],
  radius: number,
  surface?: RunSurfaceTarget | null,
): ScenePort | null {
  let best: ScenePort | null = null
  let bestDistSq = radius * radius
  for (const port of ports) {
    if (surface?.kind === 'wall') {
      const planeDistance =
        (port.position[0] - surface.frame.origin[0]) * surface.frame.normal[0] +
        (port.position[1] - surface.frame.origin[1]) * surface.frame.normal[1] +
        (port.position[2] - surface.frame.origin[2]) * surface.frame.normal[2]
      if (Math.abs(planeDistance) > radius) continue
    }
    const dx = port.position[0] - point[0]
    const dy = port.position[1] - point[1]
    const dz = port.position[2] - point[2]
    const distSq = dx * dx + dy * dy + dz * dz
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
  filter: { excludeNodeId?: AnyNodeId; kinds?: readonly string[]; levelId?: AnyNodeId } = {},
): RunBodyHit | null {
  const kinds = filter.kinds ?? ['duct-segment']
  const { nodes } = useScene.getState()
  let best: RunBodyHit | null = null
  let bestDistSq = radius * radius
  for (const node of Object.values(nodes)) {
    if (!node || !kinds.includes(node.type) || node.id === filter.excludeNodeId) continue
    if (filter.levelId && findLevelAncestorId(node.id, nodes) !== filter.levelId) continue
    const path = (node as { path?: Array<readonly [number, number, number]> }).path
    if (!path) continue
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

/** Nearest run centerline point using true 3D distance, including risers. */
export function findNearestRunBody3D(
  point: readonly [number, number, number],
  radius: number,
  filter: { excludeNodeId?: AnyNodeId; kinds?: readonly string[]; levelId?: AnyNodeId } = {},
  surface?: RunSurfaceTarget | null,
): RunBodyHit | null {
  const kinds = filter.kinds ?? ['duct-segment']
  const { nodes } = useScene.getState()
  let best: RunBodyHit | null = null
  let bestDistSq = radius * radius
  for (const node of Object.values(nodes)) {
    if (!node || !kinds.includes(node.type) || node.id === filter.excludeNodeId) continue
    if (filter.levelId && findLevelAncestorId(node.id, nodes) !== filter.levelId) continue
    if (node.visible === false) continue
    const path = (node as { path?: Array<readonly [number, number, number]> }).path
    if (!path) continue
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!
      const b = path[i + 1]!
      if (surface?.kind === 'wall') {
        const aPlane =
          (a[0] - surface.frame.origin[0]) * surface.frame.normal[0] +
          (a[1] - surface.frame.origin[1]) * surface.frame.normal[1] +
          (a[2] - surface.frame.origin[2]) * surface.frame.normal[2]
        const bPlane =
          (b[0] - surface.frame.origin[0]) * surface.frame.normal[0] +
          (b[1] - surface.frame.origin[1]) * surface.frame.normal[1] +
          (b[2] - surface.frame.origin[2]) * surface.frame.normal[2]
        if (Math.abs(aPlane) > radius && Math.abs(bPlane) > radius) continue
      }
      const abx = b[0] - a[0]
      const aby = b[1] - a[1]
      const abz = b[2] - a[2]
      const lenSq = abx * abx + aby * aby + abz * abz
      if (lenSq < 1e-8) continue
      const t = Math.min(
        1,
        Math.max(
          0,
          ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby + (point[2] - a[2]) * abz) / lenSq,
        ),
      )
      const hit: [number, number, number] = [a[0] + abx * t, a[1] + aby * t, a[2] + abz * t]
      const dx = point[0] - hit[0]
      const dy = point[1] - hit[1]
      const dz = point[2] - hit[2]
      const distSq = dx * dx + dy * dy + dz * dz
      if (distSq <= bestDistSq) {
        bestDistSq = distSq
        best = { nodeId: node.id, segmentIndex: i, point: hit }
      }
    }
  }
  return best
}

/**
 * Where a drawn segment `start`→`end` crosses straight THROUGH an
 * existing run's centerline in XZ — the four-way (cross) case, as
 * opposed to ending ON a run (the tee case). The crossing must be
 * INTERIOR to both: strictly between the drawn segment's ends (so the
 * run truly passes through, not just touches at a tip — those are tee
 * taps) and strictly inside the hit trunk segment, clear of its joints
 * by `endMargin` meters so the run legs have room. The hit's `point`
 * adopts the trunk centerline's interpolated 3D position (the drawn run
 * snaps onto the trunk's height). Returns the nearest such crossing, or
 * null. Vertical risers (no XZ extent) are skipped, same as the body
 * query.
 */
export function findRunBodyCrossingXZ(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  endMargin: number,
  filter: { excludeNodeId?: AnyNodeId; kinds?: readonly string[] } = {},
): RunBodyHit | null {
  const kinds = filter.kinds ?? ['duct-segment']
  const { nodes } = useScene.getState()
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const drawnLenSq = dx * dx + dz * dz
  if (drawnLenSq < 1e-8) return null
  const drawnLen = Math.sqrt(drawnLenSq)
  // Interior margins as a fraction of each segment's length.
  const drawnPad = Math.min(0.45, endMargin / drawnLen)
  let best: RunBodyHit | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const node of Object.values(nodes)) {
    if (!node || !kinds.includes(node.type) || node.id === filter.excludeNodeId) continue
    const path = (node as { path?: Array<readonly [number, number, number]> }).path
    if (!path) continue
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!
      const b = path[i + 1]!
      const ex = b[0] - a[0]
      const ez = b[2] - a[2]
      const runLenSq = ex * ex + ez * ez
      if (runLenSq < 1e-8) continue // vertical riser — no XZ extent
      // Solve start + s·d = a + t·e in XZ. denom is the 2D cross of the
      // two directions; ~0 means parallel (no single crossing).
      const denom = dx * ez - dz * ex
      if (Math.abs(denom) < 1e-9) continue
      const wx = a[0] - start[0]
      const wz = a[2] - start[2]
      const s = (wx * ez - wz * ex) / denom
      const t = (wx * dz - wz * dx) / denom
      const runLen = Math.sqrt(runLenSq)
      const runPad = Math.min(0.45, endMargin / runLen)
      // Strictly interior to both segments, clear of the trunk's joints.
      if (s <= drawnPad || s >= 1 - drawnPad) continue
      if (t <= runPad || t >= 1 - runPad) continue
      // Prefer the crossing nearest the drawn start (first run hit).
      if (s < bestScore) {
        bestScore = s
        best = {
          nodeId: node.id,
          segmentIndex: i,
          point: [a[0] + ex * t, a[1] + (b[1] - a[1]) * t, a[2] + ez * t],
        }
      }
    }
  }
  return best
}

/** Surface-local crossing for wall drafting. Intersects projected U/V lines
 * and ignores runs that are not coplanar with the selected wall. */
export function findRunBodyCrossingSurface(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  endMargin: number,
  surface: RunSurfaceTarget,
  filter: { excludeNodeId?: AnyNodeId; kinds?: readonly string[] } = {},
): RunBodyHit | null {
  const project = (p: readonly [number, number, number]): [number, number, number] => {
    const d: [number, number, number] = [
      p[0] - surface.frame.origin[0],
      p[1] - surface.frame.origin[1],
      p[2] - surface.frame.origin[2],
    ]
    return [
      d[0] * surface.frame.tangent[0] +
        d[1] * surface.frame.tangent[1] +
        d[2] * surface.frame.tangent[2],
      d[0] * surface.frame.bitangent[0] +
        d[1] * surface.frame.bitangent[1] +
        d[2] * surface.frame.bitangent[2],
      d[0] * surface.frame.normal[0] +
        d[1] * surface.frame.normal[1] +
        d[2] * surface.frame.normal[2],
    ]
  }
  const s0 = project(start),
    s1 = project(end)
  const dx = s1[0] - s0[0],
    dy = s1[1] - s0[1]
  const drawnLen = Math.hypot(dx, dy)
  if (drawnLen < 1e-8) return null
  const drawnPad = Math.min(0.45, endMargin / drawnLen)
  const kinds = filter.kinds ?? ['duct-segment']
  const { nodes } = useScene.getState()
  let best: RunBodyHit | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const node of Object.values(nodes)) {
    if (
      !node ||
      node.visible === false ||
      node.parentId !== surface.levelId ||
      !kinds.includes(node.type) ||
      node.id === filter.excludeNodeId
    )
      continue
    const path = (node as { path?: Array<readonly [number, number, number]> }).path
    if (!path) continue
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!,
        b = path[i + 1]!,
        pa = project(a),
        pb = project(b)
      const ex = pb[0] - pa[0],
        ey = pb[1] - pa[1],
        runLen = Math.hypot(ex, ey)
      const denom = dx * ey - dy * ex
      if (runLen < 1e-8 || Math.abs(denom) < 1e-9) continue
      const wx = pa[0] - s0[0],
        wy = pa[1] - s0[1]
      const s = (wx * ey - wy * ex) / denom,
        t = (wx * dy - wy * dx) / denom
      if (Math.abs(pa[2] + t * (pb[2] - pa[2]) - (s0[2] + s * (s1[2] - s0[2]))) > 0.01) continue
      const runPad = Math.min(0.45, endMargin / runLen)
      if (s <= drawnPad || s >= 1 - drawnPad || t <= runPad || t >= 1 - runPad || s >= bestScore)
        continue
      bestScore = s
      best = {
        nodeId: node.id,
        segmentIndex: i,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
      }
    }
  }
  return best
}
