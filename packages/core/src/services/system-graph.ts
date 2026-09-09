import { type NodePort, nodeRegistry } from '../registry'
import type { AnyNode, AnyNodeId, BuildingNode } from '../schema'
import { getLevelElevations } from './storey'

/**
 * The "System" primitive: connected components over the port graph.
 *
 * Two nodes are joined when a port of one coincides in space with a port
 * of the other — the same mated-joint relationship `port-connectivity`
 * uses for drag propagation, read here at whole-scene scope. A component
 * is one distribution system: a furnace, its trunk, the tees, branches,
 * and registers hanging off it.
 *
 * Pure logic (def.ports + arithmetic), no rendering — lives in core so
 * the editor (badges, schedules) and analyses (sizing, code checks) can
 * share it.
 */

/** Distance (meters) under which two ports count as the same joint —
 *  matches port-connectivity's tolerance for hand-placed joints. */
const COINCIDENT_EPS_M = 0.05

export type SystemSummary = {
  /** Every node in this connected component. */
  nodeIds: AnyNodeId[]
  /** Distribution loops present, e.g. ['supply'], ['supply','return']. */
  systems: string[]
  /** Duct / lineset run statistics. */
  runCount: number
  runLengthM: number
  fittingCount: number
  terminalCount: number
  equipmentCount: number
  /** False = orphaned subtree: air goes nowhere (no furnace / air
   *  handler / condenser anywhere in the component). */
  connectedToEquipment: boolean
}

export type SystemPort = {
  port: NodePort
  nodeId: AnyNodeId
  x: number
  y: number
  z: number
  system: string | undefined
}

export function collectSystemPorts(nodes: Readonly<Record<AnyNodeId, AnyNode>>): SystemPort[] {
  const result: SystemPort[] = []
  for (const node of Object.values(nodes)) {
    if (!node) continue
    const ports = nodeRegistry.get(node.type)?.ports?.(node)
    if (!ports) continue
    for (const port of ports) {
      const [x, y, z] = distributionPointToWorld(node, port.position, nodes)
      result.push({
        port,
        nodeId: node.id,
        x,
        y,
        z,
        system: port.system,
      })
    }
  }
  return result
}

export function distributionPointToWorld(
  node: AnyNode,
  point: readonly [number, number, number],
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): [number, number, number] {
  const elevations = getLevelElevations(nodes)
  let ancestor: AnyNode | undefined = node
  const visited = new Set<AnyNodeId>()
  while (ancestor && ancestor.type !== 'level' && !visited.has(ancestor.id)) {
    visited.add(ancestor.id)
    ancestor = ancestor.parentId ? nodes[ancestor.parentId as AnyNodeId] : undefined
  }
  const elevation = ancestor?.type === 'level' ? elevations.get(ancestor.id) : undefined
  const building = elevation?.buildingId ? nodes[elevation.buildingId as AnyNodeId] : undefined
  let [x, y, z] = point
  y += elevation?.baseY ?? 0
  if (building?.type === 'building') {
    const { position, rotation } = building as BuildingNode
    const [rx, ry, rz] = rotation
    const zx = Math.cos(rz) * x - Math.sin(rz) * y
    const zy = Math.sin(rz) * x + Math.cos(rz) * y
    const yx = Math.cos(ry) * zx + Math.sin(ry) * z
    const yz = -Math.sin(ry) * zx + Math.cos(ry) * z
    x = yx + position[0]
    y = Math.cos(rx) * zy - Math.sin(rx) * yz + position[1]
    z = Math.sin(rx) * zy + Math.cos(rx) * yz + position[2]
  }
  return [x, y, z]
}

/** Union-find over node ids. */
class Components {
  private parent = new Map<AnyNodeId, AnyNodeId>()

  find(id: AnyNodeId): AnyNodeId {
    let root = this.parent.get(id) ?? id
    if (root !== id) {
      root = this.find(root)
      this.parent.set(id, root)
    }
    return root
  }

  union(a: AnyNodeId, b: AnyNodeId): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

function pathLength(path: ReadonlyArray<readonly [number, number, number]>): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return total
}

/**
 * Group every port-bearing node into connected components via coinciding
 * ports. Nodes with ports but no joints form singleton components; nodes
 * without `def.ports` don't participate at all.
 */
export function buildPortComponents(nodes: Readonly<Record<AnyNodeId, AnyNode>>): AnyNodeId[][] {
  const ports = collectSystemPorts(nodes)
  const components = new Components()
  const epsSq = COINCIDENT_EPS_M * COINCIDENT_EPS_M

  for (let i = 0; i < ports.length; i++) {
    const a = ports[i]!
    for (let j = i + 1; j < ports.length; j++) {
      const b = ports[j]!
      if (a.nodeId === b.nodeId) continue
      if (a.system && b.system && a.system !== b.system) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dz = a.z - b.z
      if (dx * dx + dy * dy + dz * dz <= epsSq) components.union(a.nodeId, b.nodeId)
    }
  }

  const grouped = new Map<AnyNodeId, AnyNodeId[]>()
  const seen = new Set<AnyNodeId>()
  for (const port of ports) {
    if (seen.has(port.nodeId)) continue
    seen.add(port.nodeId)
    const root = components.find(port.nodeId)
    const group = grouped.get(root)
    if (group) group.push(port.nodeId)
    else grouped.set(root, [port.nodeId])
  }
  return [...grouped.values()]
}

function summarize(
  nodeIds: AnyNodeId[],
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): SystemSummary {
  const systems = new Set<string>()
  let runCount = 0
  let runLengthM = 0
  let fittingCount = 0
  let terminalCount = 0
  let equipmentCount = 0

  for (const id of nodeIds) {
    const node = nodes[id]
    if (!node) continue
    const role = nodeRegistry.get(node.type)?.distributionRole
    const fields = node as {
      path?: ReadonlyArray<readonly [number, number, number]>
      system?: string
      terminalType?: string
    }
    if (role === 'run') {
      runCount += 1
      if (fields.path) runLengthM += pathLength(fields.path)
      // Linesets carry refrigerant; duct / pipe runs name their own loop.
      systems.add(fields.system ?? 'refrigerant')
    } else if (role === 'fitting') {
      fittingCount += 1
      if (fields.system) systems.add(fields.system)
    } else if (role === 'terminal') {
      terminalCount += 1
      systems.add(fields.terminalType === 'return-grille' ? 'return' : 'supply')
    } else if (role === 'equipment') {
      equipmentCount += 1
    }
  }

  return {
    nodeIds,
    systems: [...systems].sort(),
    runCount,
    runLengthM,
    fittingCount,
    terminalCount,
    equipmentCount,
    connectedToEquipment: equipmentCount > 0,
  }
}

/**
 * Summary of the system the given node belongs to, or null when the node
 * has no ports (not a distribution kind). A node with ports but no
 * joints yet still gets a (singleton) summary — `connectedToEquipment:
 * false` is the interesting signal there.
 */
export function summarizeSystemFor(
  nodeId: AnyNodeId,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): SystemSummary | null {
  const node = nodes[nodeId]
  if (!node) return null
  const ports = nodeRegistry.get(node.type)?.ports?.(node)
  if (!ports || ports.length === 0) return null
  for (const component of buildPortComponents(nodes)) {
    if (component.includes(nodeId)) return summarize(component, nodes)
  }
  return summarize([nodeId], nodes)
}
