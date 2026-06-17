import { nodeRegistry } from '../registry'
import type { AnyNode, AnyNodeId } from '../schema'

/**
 * Connectivity-aware editing for port-bearing distribution kinds
 * (HVAC ductwork AND DWV plumbing).
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
 * Propagation is intentionally bounded. A moved node stretches the ducts
 * touching it (their near endpoint follows) and rigidly drags any fitting
 * mated collar-to-collar. It also carries the *sibling* ducts on that
 * dragged-along fitting — the other runs sharing the fitting's collars —
 * so dragging one duct's corner moves the whole joint together instead of
 * tearing the fitting away from its other legs. Their near endpoints
 * translate with the fitting; their far ends stay put (they stretch). It
 * stops there: it does NOT chase those far ends or hop onward through the
 * next fitting. Bounded and predictable — no runaway network rearrangement.
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
  | {
      /** A sibling duct hanging off one of the dragged-along fitting's OTHER
       *  collars (second hop). The fitting follows the moved port rigidly, so
       *  this run's near endpoint translates by that same delta to stay welded
       *  to its collar — the whole joint moves together. The far endpoint
       *  stays put (the run stretches). */
      kind: 'duct-endpoint-follow'
      nodeId: AnyNodeId
      /** Index in the run's `path` that rides the fitting. */
      pathIndex: number
      /** The moved node's port id whose delta drives the fitting (and so this
       *  run's endpoint). */
      movedPortId: string
      /** The run's full path at edit-start (other points are preserved). */
      startPath: Point[]
    }

export type PortConnectivity = {
  movedNodeId: AnyNodeId
  /** The moved node's port world positions at edit-start, keyed by port id.
   *  Used as the reference each connection's delta is measured from. */
  startMovedPorts: Record<string, Point>
  connections: PortConnection[]
}

function portsOf(
  node: AnyNode,
): ReadonlyArray<{ id: string; position: Point; system?: string }> | undefined {
  return nodeRegistry.get(node.type)?.ports?.(node) as
    | ReadonlyArray<{ id: string; position: Point; system?: string }>
    | undefined
}

/** A node's distribution role from the registry (run / fitting / …). */
function roleOf(node: AnyNode): string | undefined {
  return nodeRegistry.get(node.type)?.distributionRole
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
 * Only `run`-role partners (segments — endpoint stretch) and `fitting`-role
 * partners (rigid follow) are tracked — terminals and equipment usually mount
 * to a surface and shouldn't be yanked off it when an adjacent fitting nudges.
 */
export function analyzePortConnectivity(
  movedNode: AnyNode,
  nodes: Record<string, AnyNode>,
): PortConnectivity {
  const movedPorts = portsOf(movedNode) ?? []
  const startMovedPorts: Record<string, Point> = {}
  const movedPortSystem: Record<string, string | undefined> = {}
  for (const p of movedPorts) {
    startMovedPorts[p.id] = p.position
    movedPortSystem[p.id] = p.system
  }

  const connections: PortConnection[] = []
  const epsSq = COINCIDENT_EPS_M * COINCIDENT_EPS_M

  for (const other of Object.values(nodes)) {
    if (!other || other.id === movedNode.id) continue
    // Generalised across every distribution family (HVAC duct + DWV pipe):
    // `run` partners stretch an endpoint, `fitting` partners follow rigidly.
    // Terminals/equipment mount to surfaces and are intentionally NOT dragged.
    // Fittings that declare `portConnectivityFollow: false` are anchored
    // fixtures (e.g. pipe-trap) — moving a connected run stretches the arm.
    const otherRole = roleOf(other)
    if (otherRole !== 'run' && otherRole !== 'fitting') continue
    const otherDef = nodeRegistry.get(other.type)
    if (otherRole === 'fitting' && otherDef?.portConnectivityFollow === false) continue
    const otherPorts = portsOf(other)
    if (!otherPorts) continue

    for (const op of otherPorts) {
      // Find which of the moved node's ports this partner port sits on.
      let matchedId: string | null = null
      for (const mp of movedPorts) {
        if (distSq(op.position, mp.position) > epsSq) continue
        // Don't fuse ports from incompatible systems (e.g. a supply duct
        // and a waste pipe that happen to cross): only mate when both
        // ports declare the same system, or at least one is unscoped.
        const ms = movedPortSystem[mp.id]
        if (ms && op.system && ms !== op.system) continue
        matchedId = mp.id
        break
      }
      if (!matchedId) continue

      if (otherRole === 'run') {
        const path = (other as unknown as { path?: Point[] }).path
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

  // Second hop: each fitting we drag rigidly carries its OTHER runs along.
  // Find every run endpoint sitting on one of that fitting's collars (apart
  // from the run we're already moving) and drive it by the same port delta,
  // so the whole joint translates together instead of the fitting peeling
  // off its other legs.
  const rigidFittings = connections.filter(
    (c): c is Extract<PortConnection, { kind: 'rigid-node' }> => c.kind === 'rigid-node',
  )
  const alreadyTracked = new Set(connections.map((c) => c.nodeId))
  alreadyTracked.add(movedNode.id as AnyNodeId)
  for (const fittingConn of rigidFittings) {
    const fitting = nodes[fittingConn.nodeId]
    if (!fitting) continue
    const fittingPorts = portsOf(fitting) ?? []
    for (const fp of fittingPorts) {
      for (const other of Object.values(nodes)) {
        if (!other || alreadyTracked.has(other.id as AnyNodeId)) continue
        if (roleOf(other) !== 'run') continue
        const path = (other as unknown as { path?: Point[] }).path
        if (!Array.isArray(path) || path.length < 2) continue
        const otherPorts = portsOf(other)
        if (!otherPorts) continue
        const ep = otherPorts.find((p) => distSq(p.position, fp.position) <= epsSq)
        if (!ep) continue
        if (ep.system && fp.system && ep.system !== fp.system) continue
        connections.push({
          kind: 'duct-endpoint-follow',
          nodeId: other.id,
          pathIndex: ep.id === 'start' ? 0 : path.length - 1,
          movedPortId: fittingConn.movedPortId,
          startPath: path.map((p) => [...p] as Point),
        })
        alreadyTracked.add(other.id as AnyNodeId)
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
    } else if (conn.kind === 'duct-endpoint-follow') {
      // Sibling run on a dragged-along fitting: translate its near endpoint by
      // the same port delta the fitting follows. Far end stays put (stretch).
      const dx = now[0] - start[0]
      const dy = now[1] - start[1]
      const dz = now[2] - start[2]
      const path = conn.startPath.map((p, i) =>
        i === conn.pathIndex ? ([p[0] + dx, p[1] + dy, p[2] + dz] as Point) : ([...p] as Point),
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
