import { type NodePort, nodeRegistry } from '../registry'
import type { AnyNode, AnyNodeId } from '../schema'
import {
  type DistributionFrame,
  distributionFrame,
  distributionPointFromWorld,
  distributionPointInFrame,
  distributionVectorToWorld,
} from './distribution-frame'
import { portConnection } from './port-connection'
import { getLevelElevations } from './storey'

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
 * core and is consumed by the editor's move tool and the duct/pipe
 * selection affordances alike.
 *
 * ## Propagation model
 *
 * The joint graph is snapshotted once at drag start (`analyzePortConnectivity`)
 * and walked every frame (`resolveConnectivityUpdates`) given the moved node's
 * live transform. Deltas flow outward from the moved node through coincident
 * ports:
 *
 * - **Fitting** (rigid): a collar pushed by delta `d` translates the whole
 *   fitting by `d`; every other collar carries that same `d` onward.
 * - **Run** (stretch + slide, never skew): an endpoint pushed by delta `d` is
 *   split against the run's own axis. The *parallel* part slides only that
 *   endpoint (the run lengthens / shortens); the *perpendicular* part
 *   translates the entire run (so its direction is preserved). The far
 *   endpoint therefore moves by just the perpendicular part, and that part
 *   propagates onward to whatever is mated to the far endpoint.
 *
 * Propagation walks the whole connected component so a joint stays welded all
 * the way down the chain, with a visited guard so cycles (looped runs) and
 * shared joints terminate. First-reached (shortest path) wins on a node
 * reachable two ways.
 */

type Point = readonly [number, number, number]

/** Below this (meters) a propagated delta is treated as zero — stops the
 *  walk from chasing sub-millimeter perpendicular residue. */
const DELTA_EPS_M = 1e-4
const PROPAGATION_EPS_M = 1e-9

/** A node carried by the edit, plus the snapshot needed to revert it. Kept
 *  deliberately small: the move tools read only `kind` + `nodeId` and the
 *  matching start snapshot to revert before the single tracked commit. */
export type PortConnection =
  | {
      /** A fitting mated collar-to-collar: it translates rigidly. */
      kind: 'rigid-node'
      nodeId: AnyNodeId
      /** Node's `position` at edit-start. */
      startPosition: Point
    }
  | {
      /** A run whose endpoint(s) ride the edit: it stretches and/or
       *  translates, never skews. */
      kind: 'run'
      nodeId: AnyNodeId
      /** The run's full `path` at edit-start. */
      startPath: Point[]
    }

/** One node in the snapshotted joint graph (everything reachable from the
 *  moved node, excluding the moved node itself). */
type GraphNode = {
  id: AnyNodeId
  role: 'run' | 'fitting'
  ports: readonly NodePort[]
  startPath?: Point[]
  startPosition?: Point
}

/** Who else sits on a given node's port, keyed `nodeId` → `portId` → mates. */
type Adjacency = Record<string, Record<string, Array<{ nodeId: AnyNodeId; portId: string }>>>

export type PortConnectivity = {
  frames?: Record<string, DistributionFrame>
  customResolver?: (preview: AnyNode) => { id: AnyNodeId; data: Partial<AnyNode> }[]
  movedNodeId: AnyNodeId
  /** The moved node's port world positions at edit-start, keyed by port id —
   *  the reference each frame's delta is measured from. */
  startMovedPorts: Record<string, Point>
  /** Reachable run/fitting nodes (excludes the moved node), keyed by id. */
  graph: Record<string, GraphNode>
  /** Port coincidence edges across the moved node + every graph node. */
  adjacency: Adjacency
  /** Flat list of carried nodes for the move tools' revert + "anything to
   *  follow?" check. Derived from `graph`. */
  connections: PortConnection[]
}

function portsOf(node: AnyNode, frame: DistributionFrame): NodePort[] {
  return (nodeRegistry.get(node.type)?.ports?.(node) ?? []).map((port) => ({
    ...port,
    position: distributionPointInFrame(frame, port.position),
    direction: distributionVectorToWorld(frame, port.direction),
  }))
}

/** A node's distribution role from the registry (run / fitting / …). */
function roleOf(node: AnyNode): string | undefined {
  return nodeRegistry.get(node.type)?.distributionRole
}

/**
 * Snapshot the joint graph reachable from `movedNode`'s ports, taken at the
 * start of a move/resize. Call once before the drag; feed the result to
 * `resolveConnectivityUpdates` on every frame.
 *
 * Only `run`-role partners (segments) and `fitting`-role partners are walked —
 * terminals and equipment usually mount to a surface and shouldn't be yanked
 * off it when an adjacent fitting nudges. Fittings that declare
 * `portConnectivityFollow: false` are anchored fixtures (e.g. pipe-trap) and
 * are skipped, so a connected run stretches against them instead.
 */
export function analyzePortConnectivity(
  movedNode: AnyNode,
  nodes: Record<string, AnyNode>,
): PortConnectivity {
  const custom = nodeRegistry.get(movedNode.type)?.connectedMove
  if (custom) {
    const resolve = (preview: AnyNode) => custom(movedNode, preview, nodes)
    const initial = resolve(movedNode)
    return {
      movedNodeId: movedNode.id as AnyNodeId,
      customResolver: resolve,
      startMovedPorts: {},
      graph: {},
      adjacency: {},
      connections: initial.flatMap((update) => {
        const path = (nodes[update.id] as unknown as { path?: Point[] })?.path
        if (path)
          return [
            {
              kind: 'run' as const,
              nodeId: update.id,
              startPath: path.map((p) => [...p] as Point),
            },
          ] as PortConnection[]
        const position = (nodes[update.id] as unknown as { position?: Point })?.position
        return position
          ? [
              {
                kind: 'rigid-node' as const,
                nodeId: update.id,
                startPosition: [...position] as Point,
              },
            ]
          : []
      }),
    }
  }
  const elevations = getLevelElevations(nodes)
  const frames: Record<string, DistributionFrame> = {}
  const frameOf = (node: AnyNode) =>
    (frames[node.id] ??= distributionFrame(node, nodes, elevations))
  const movedPorts = portsOf(movedNode, frameOf(movedNode))
  const startMovedPorts: Record<string, Point> = {}
  for (const p of movedPorts) startMovedPorts[p.id] = p.position

  // Candidate partners: every run + every following fitting in the scene.
  const candidates: GraphNode[] = []
  for (const other of Object.values(nodes)) {
    if (!other || other.id === movedNode.id) continue
    const role = roleOf(other)
    if (role !== 'run' && role !== 'fitting') continue
    if (role === 'fitting' && nodeRegistry.get(other.type)?.portConnectivityFollow === false) {
      continue
    }
    const ports = portsOf(other, frameOf(other))
    if (ports.length === 0) continue
    const startPath =
      role === 'run'
        ? (other as unknown as { path?: Point[] }).path?.map((p) =>
            distributionPointInFrame(frameOf(other), p),
          )
        : undefined
    if (role === 'run' && (!startPath || startPath.length < 2)) continue
    const startPosition =
      role === 'fitting'
        ? (() => {
            const pos = (other as unknown as { position?: Point }).position
            return pos ? distributionPointInFrame(frameOf(other), pos) : undefined
          })()
        : undefined
    if (role === 'fitting' && !startPosition) continue
    candidates.push({ id: other.id as AnyNodeId, role, ports, startPath, startPosition })
  }

  // Walk outward from the moved node, collecting every node reachable through
  // coincident ports. The adjacency records each port's mates so the resolver
  // can replay the same edges with live deltas.
  const adjacency: Adjacency = {}
  const addEdge = (nodeId: string, portId: string, mate: { nodeId: AnyNodeId; portId: string }) => {
    const byPort = adjacency[nodeId] ?? {}
    adjacency[nodeId] = byPort
    const mates = byPort[portId] ?? []
    byPort[portId] = mates
    mates.push(mate)
  }

  const graph: Record<string, GraphNode> = {}
  const visited = new Set<string>([movedNode.id])

  // Seed: the moved node's own ports.
  const queue: Array<{
    id: string
    ports: readonly NodePort[]
  }> = [{ id: movedNode.id, ports: movedPorts }]

  while (queue.length > 0) {
    const { id, ports } = queue.shift()!
    for (const port of ports) {
      for (const cand of candidates) {
        if (cand.id === id) continue
        for (const cp of cand.ports) {
          if (portConnection(port, cp).status !== 'match') continue
          addEdge(id, port.id, { nodeId: cand.id, portId: cp.id })
          addEdge(cand.id, cp.id, { nodeId: id as AnyNodeId, portId: port.id })
          if (!visited.has(cand.id)) {
            visited.add(cand.id)
            graph[cand.id] = cand
            queue.push({ id: cand.id, ports: cand.ports })
          }
        }
      }
    }
  }

  const connections: PortConnection[] = Object.values(graph).map((g) =>
    g.role === 'fitting'
      ? {
          kind: 'rigid-node',
          nodeId: g.id,
          startPosition: [...(nodes[g.id] as unknown as { position: Point }).position] as Point,
        }
      : {
          kind: 'run',
          nodeId: g.id,
          startPath: (nodes[g.id] as unknown as { path: Point[] }).path.map(
            (point) => [...point] as Point,
          ),
        },
  )

  return {
    movedNodeId: movedNode.id as AnyNodeId,
    startMovedPorts,
    frames,
    graph,
    adjacency,
    connections,
  }
}

function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function lenSq(v: Point): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
}

/** Split `delta` into the component along unit `axis` and the remainder. */
function decompose(delta: Point, axis: Point): { parallel: Point; perp: Point } {
  const dot = delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2]
  const parallel: Point = [axis[0] * dot, axis[1] * dot, axis[2] * dot]
  return { parallel, perp: sub(delta, parallel) }
}

function scale(v: Point, scalar: number): Point {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar]
}

function average(deltas: Point[]): Point {
  const sum = deltas.reduce<Point>((acc, delta) => add(acc, delta), [0, 0, 0])
  return scale(sum, 1 / deltas.length)
}

function nearlyEqual(a: Point, b: Point): boolean {
  return lenSq(sub(a, b)) <= DELTA_EPS_M * DELTA_EPS_M
}

function propagationEqual(a: Point, b: Point): boolean {
  return lenSq(sub(a, b)) <= PROPAGATION_EPS_M * PROPAGATION_EPS_M
}

function effectivePortDeltas(
  constraints: Record<string, Record<string, Point>>,
): Record<string, Point> {
  return Object.fromEntries(
    Object.entries(constraints).map(([portId, bySource]) => [
      portId,
      average(Object.values(bySource)),
    ]),
  )
}

/** Unit direction of the run's segment adjacent to its `start` / `end` tip. */
function endpointAxis(path: Point[], portId: string): Point {
  const n = path.length
  const [a, b] = portId === 'start' ? [path[1]!, path[0]!] : [path[n - 2]!, path[n - 1]!]
  const dir = sub(b, a)
  const l2 = lenSq(dir)
  if (l2 < 1e-12) return [0, 0, 0]
  const l = Math.sqrt(l2)
  return [dir[0] / l, dir[1] / l, dir[2] / l]
}

function runPathFromSinglePortDelta(
  startPath: Point[],
  portId: 'start' | 'end',
  delta: Point,
): Point[] {
  const nearIdx = portId === 'start' ? 0 : startPath.length - 1
  const axis = endpointAxis(startPath, portId)
  const { parallel, perp } = decompose(delta, axis)
  const path = startPath.map((p) => add(p, perp))
  path[nearIdx] = add(path[nearIdx]!, parallel)
  return path
}

function runEndpointDeltas(startPath: Point[], path: Point[]): Record<string, Point> {
  return {
    start: sub(path[0]!, startPath[0]!),
    end: sub(path[path.length - 1]!, startPath[startPath.length - 1]!),
  }
}

function runPathFromPortDeltas(startPath: Point[], portDeltas: Record<string, Point>): Point[] {
  const startDelta = portDeltas.start
  const endDelta = portDeltas.end
  if (startDelta && endDelta) {
    if (startPath.length === 2) {
      return [add(startPath[0]!, startDelta), add(startPath[1]!, endDelta)]
    }

    if (nearlyEqual(startDelta, endDelta)) {
      return startPath.map((p) => add(p, startDelta))
    }

    const startParts = decompose(startDelta, endpointAxis(startPath, 'start'))
    const endParts = decompose(endDelta, endpointAxis(startPath, 'end'))
    const commonPerp = average([startParts.perp, endParts.perp])
    const path = startPath.map((p) => add(p, commonPerp))
    path[0] = add(path[0]!, startParts.parallel)
    path[path.length - 1] = add(path[path.length - 1]!, endParts.parallel)
    return path
  }

  return runPathFromSinglePortDelta(
    startPath,
    startDelta ? 'start' : 'end',
    (startDelta ?? endDelta)!,
  )
}

/**
 * Given the moved node in its live (in-drag) transform, produce the patches
 * that keep every connected node attached. `previewNode` is the moved node
 * with its current drag position/rotation applied so its ports recompute.
 *
 * Walks the snapshotted graph, propagating each port delta outward: fittings
 * translate rigidly, runs stretch along their axis and translate across it
 * (never skew when driven from one end), and effective port movement carries on
 * to neighbouring joints. Port-level output guards bound cycles while still
 * allowing a looped/shared run to accept constraints at both endpoints.
 */
export function resolveConnectivityUpdates(
  connectivity: PortConnectivity,
  previewNode: AnyNode,
): { id: AnyNodeId; data: Partial<AnyNode> }[] {
  if (connectivity.customResolver) return connectivity.customResolver(previewNode)
  const { graph, adjacency, startMovedPorts, movedNodeId } = connectivity
  if (Object.keys(graph).length === 0) return []

  const newPorts = portsOf(previewNode, connectivity.frames![movedNodeId]!)
  const newMovedPos: Record<string, Point> = {}
  for (const p of newPorts) newMovedPos[p.id] = p.position

  // Each queue item drives a node's port by a delta ("this collar / endpoint
  // must move by this much").
  const queue: Array<{ nodeId: AnyNodeId; portId: string; delta: Point; sourceKey: string }> = []
  const results: Record<string, { id: AnyNodeId; data: Partial<AnyNode> }> = {}
  const constrainedPorts: Record<string, Record<string, Record<string, Point>>> = {}
  const propagatedPorts: Record<string, Record<string, Point>> = {}

  const enqueueMates = (nodeId: string, portId: string, delta: Point) => {
    const byPort = propagatedPorts[nodeId] ?? {}
    propagatedPorts[nodeId] = byPort
    const previous = byPort[portId]
    if (previous && propagationEqual(previous, delta)) return
    byPort[portId] = delta

    for (const mate of adjacency[nodeId]?.[portId] ?? []) {
      if (mate.nodeId === movedNodeId) continue
      queue.push({
        nodeId: mate.nodeId,
        portId: mate.portId,
        delta,
        sourceKey: `${nodeId}:${portId}`,
      })
    }
  }

  const acceptPortDelta = (
    nodeId: AnyNodeId,
    portId: string,
    sourceKey: string,
    delta: Point,
  ): boolean => {
    const byPort = constrainedPorts[nodeId] ?? {}
    constrainedPorts[nodeId] = byPort
    const bySource = byPort[portId] ?? {}
    byPort[portId] = bySource
    const existing = bySource[sourceKey]
    if (existing && propagationEqual(existing, delta)) {
      return false
    }
    bySource[sourceKey] = delta
    return true
  }

  // Seed from the moved node's live port deltas.
  for (const [portId, start] of Object.entries(startMovedPorts)) {
    const now = newMovedPos[portId]
    if (!now) continue
    const delta = sub(now, start)
    if (lenSq(delta) <= DELTA_EPS_M * DELTA_EPS_M) continue
    enqueueMates(movedNodeId, portId, delta)
  }

  while (queue.length > 0) {
    const { nodeId, portId, delta, sourceKey } = queue.shift()!
    const node = graph[nodeId]
    if (!node) continue
    if (!acceptPortDelta(nodeId, portId, sourceKey, delta)) continue
    const portDeltas = effectivePortDeltas(constrainedPorts[nodeId]!)

    if (node.role === 'fitting') {
      const start = node.startPosition!
      const effectiveDelta = average(Object.values(portDeltas))
      results[nodeId] = {
        id: nodeId,
        data: { position: add(start, effectiveDelta) } as Partial<AnyNode>,
      }
      // Rigid: every collar carries the effective body translation onward.
      for (const p of node.ports) {
        enqueueMates(nodeId, p.id, effectiveDelta)
      }
    } else {
      const startPath = node.startPath!
      const path = runPathFromPortDeltas(startPath, portDeltas)
      results[nodeId] = { id: nodeId, data: { path } as Partial<AnyNode> }
      for (const [nextPortId, nextDelta] of Object.entries(runEndpointDeltas(startPath, path))) {
        if (lenSq(nextDelta) <= DELTA_EPS_M * DELTA_EPS_M) continue
        enqueueMates(nodeId, nextPortId, nextDelta)
      }
    }
  }

  return Object.values(results).map((result) => {
    const frame = connectivity.frames![result.id]!
    const data = result.data as { position?: Point; path?: Point[] }
    return {
      id: result.id,
      data: data.path
        ? ({
            path: data.path.map((point) => distributionPointFromWorld(frame, point)),
          } as Partial<AnyNode>)
        : ({ position: distributionPointFromWorld(frame, data.position!) } as Partial<AnyNode>),
    }
  })
}
