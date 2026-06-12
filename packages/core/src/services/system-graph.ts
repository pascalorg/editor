import { nodeRegistry } from '../registry'
import type { AnyNode, AnyNodeId } from '../schema'

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

type PortRecord = {
  nodeId: AnyNodeId
  x: number
  y: number
  z: number
  system: string | undefined
}

function collectPorts(nodes: Readonly<Record<AnyNodeId, AnyNode>>): PortRecord[] {
  const result: PortRecord[] = []
  for (const node of Object.values(nodes)) {
    if (!node) continue
    const ports = nodeRegistry.get(node.type)?.ports?.(node)
    if (!ports) continue
    for (const port of ports) {
      result.push({
        nodeId: node.id,
        x: port.position[0],
        y: port.position[1],
        z: port.position[2],
        system: port.system,
      })
    }
  }
  return result
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
  const ports = collectPorts(nodes)
  const components = new Components()
  const epsSq = COINCIDENT_EPS_M * COINCIDENT_EPS_M

  for (let i = 0; i < ports.length; i++) {
    const a = ports[i]!
    for (let j = i + 1; j < ports.length; j++) {
      const b = ports[j]!
      if (a.nodeId === b.nodeId) continue
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
