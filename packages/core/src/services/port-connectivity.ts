import { nodeRegistry } from '../registry'
import type { AnyNode, AnyNodeId } from '../schema'

/**
 * Connectivity-aware editing for port-bearing kinds (HVAC ductwork).
 *
 * Two nodes are "connected" when a port of one coincides in space with a
 * port of the other — exactly how the placement tools mate a fitting onto
 * a duct end (they snap the fitting's collar onto the run's open port).
 * This service reads that relationship back out so an edit to one node can
 * carry its neighbours along.
 *
 * Pure logic: it asks each node for its ports via `def.ports` (level-local
 * meters) and does arithmetic. No Three.js, no rendering — it lives in
 * core and is consumed by the editor's move tool and the duct-segment
 * system alike.
 *
 * Propagation is intentionally **one hop**: a moved fitting stretches the
 * ducts touching it (their near endpoint follows) and rigidly drags any
 * fitting mated collar-to-collar, but it does NOT chase the far end of
 * those ducts or anything beyond. Bounded and predictable — no runaway
 * network rearrangement.
 */

type Point = readonly [number, number, number]

/** Distance (meters) under which two ports count as the same joint. Joints
 *  formed by placement snapping coincide to sub-millimeter; 5 cm leaves
 *  generous slack for grid-snapped hand placement without false matches. */
const COINCIDENT_EPS_M = 0.05

/** A node attached to one of the moved node's ports, plus how it follows. */
export type PortConnection =
  | {
      /** Partner is a duct run: the endpoint touching the moved port slides
       *  to track it (one hop — the far endpoint stays put, stretching the
       *  run). */
      kind: 'duct-endpoint'
      nodeId: AnyNodeId
      /** Index in the duct's `path` that tracks the moved port. */
      pathIndex: number
      /** The moved node's port id this endpoint follows. */
      movedPortId: string
      /** The duct's full path at edit-start (other points are preserved). */
      startPath: Point[]
    }
  | {
      /** Partner is another fitting mated collar-to-collar: it translates
       *  rigidly so its collar stays on the moved collar. */
      kind: 'rigid-node'
      nodeId: AnyNodeId
      movedPortId: string
      /** Partner node's `position` at edit-start. */
      startPosition: Point
    }

export type PortConnectivity = {
  movedNodeId: AnyNodeId
  /** The moved node's port world positions at edit-start, keyed by port id.
   *  Used as the reference each connection's delta is measured from. */
  startMovedPorts: Record<string, Point>
  connections: PortConnection[]
}

function portsOf(node: AnyNode): ReadonlyArray<{ id: string; position: Point }> | undefined {
  return nodeRegistry.get(node.type)?.ports?.(node) as
    | ReadonlyArray<{ id: string; position: Point }>
    | undefined
}

function distSq(a: Point, b: Point): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

/**
 * Snapshot which nodes are connected to `movedNode`'s ports, taken at the
 * start of a move/resize. Call once before the drag; feed the result to
 * `resolveConnectivityUpdates` on every frame.
 *
 * Only duct-segment (endpoint stretch) and duct-fitting (rigid follow)
 * partners are tracked — terminals and equipment usually mount to a
 * surface and shouldn't be yanked off it when an adjacent fitting nudges.
 */
export function analyzePortConnectivity(
  movedNode: AnyNode,
  nodes: Record<string, AnyNode>,
): PortConnectivity {
  const movedPorts = portsOf(movedNode) ?? []
  const startMovedPorts: Record<string, Point> = {}
  for (const p of movedPorts) startMovedPorts[p.id] = p.position

  const connections: PortConnection[] = []
  const epsSq = COINCIDENT_EPS_M * COINCIDENT_EPS_M

  for (const other of Object.values(nodes)) {
    if (!other || other.id === movedNode.id) continue
    if (other.type !== 'duct-segment' && other.type !== 'duct-fitting') continue
    const otherPorts = portsOf(other)
    if (!otherPorts) continue

    for (const op of otherPorts) {
      // Find which of the moved node's ports this partner port sits on.
      let matchedId: string | null = null
      for (const mp of movedPorts) {
        if (distSq(op.position, mp.position) <= epsSq) {
          matchedId = mp.id
          break
        }
      }
      if (!matchedId) continue

      if (other.type === 'duct-segment') {
        const path = (other as unknown as { path: Point[] }).path
        if (!Array.isArray(path) || path.length < 2) continue
        // Port id 'start' → first point, 'end' → last point.
        const pathIndex = op.id === 'start' ? 0 : path.length - 1
        connections.push({
          kind: 'duct-endpoint',
          nodeId: other.id,
          pathIndex,
          movedPortId: matchedId,
          startPath: path.map((p) => [...p] as Point),
        })
      } else {
        const position = (other as unknown as { position?: Point }).position
        if (!position) continue
        connections.push({
          kind: 'rigid-node',
          nodeId: other.id,
          movedPortId: matchedId,
          startPosition: [position[0], position[1], position[2]],
        })
      }
    }
  }

  return { movedNodeId: movedNode.id as AnyNodeId, connections, startMovedPorts }
}

/**
 * Given the moved node in its live (in-drag) transform, produce the patches
 * that keep every connected node attached. `previewNode` is the moved node
 * with its current drag position/rotation applied so its ports recompute.
 *
 * - Duct endpoint: set the tracked path point to the moved port's new
 *   position (the joint stays welded; the run stretches).
 * - Rigid fitting: translate by the moved port's delta so its mated collar
 *   rides along.
 */
export function resolveConnectivityUpdates(
  connectivity: PortConnectivity,
  previewNode: AnyNode,
): { id: AnyNodeId; data: Partial<AnyNode> }[] {
  const newPorts = portsOf(previewNode) ?? []
  const newById: Record<string, Point> = {}
  for (const p of newPorts) newById[p.id] = p.position

  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  for (const conn of connectivity.connections) {
    const start = connectivity.startMovedPorts[conn.movedPortId]
    const now = newById[conn.movedPortId]
    if (!start || !now) continue

    if (conn.kind === 'duct-endpoint') {
      const path = conn.startPath.map((p, i) =>
        i === conn.pathIndex ? ([now[0], now[1], now[2]] as Point) : ([...p] as Point),
      )
      updates.push({ id: conn.nodeId, data: { path } as Partial<AnyNode> })
    } else {
      const dx = now[0] - start[0]
      const dy = now[1] - start[1]
      const dz = now[2] - start[2]
      updates.push({
        id: conn.nodeId,
        data: {
          position: [
            conn.startPosition[0] + dx,
            conn.startPosition[1] + dy,
            conn.startPosition[2] + dz,
          ],
        } as Partial<AnyNode>,
      })
    }
  }
  return updates
}
