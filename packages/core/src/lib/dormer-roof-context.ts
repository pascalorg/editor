import { queryNodes } from '../runtime/node-queries'
import { draftOf } from '../runtime/reader'
import type { RoofNode } from '../schema/nodes/roof'
import { RoofSegmentNode } from '../schema/nodes/roof-segment'
import type { AnyNode } from '../schema/types'
import { getLevelElevations } from '../services/storey'
import { roofSegmentFrame } from './roof-frame'
import { getRoofSegmentCoveringSeat } from './roof-surface'
import { buildRoofSegmentCoveringTriangles } from './roof-surface-geometry'

export type DormerScene = Readonly<Record<string, AnyNode>>
export type DormerExposureContext = { nodes: DormerScene }
type Point = [number, number, number]
export type DormerWindowExposure =
  | {
      status: 'exposed' | 'buried'
      position: Point
      coveringY: number | null
      clearanceM: number | null
      nodeIds: string[]
    }
  | { status: 'unmeasured'; reason: string; nodeIds: string[] }

export function dormerRoofHost(nodes: DormerScene, segment: RoofSegmentNode): RoofNode | undefined {
  const roof = nodes[segment.parentId ?? '']
  const stored = nodes[segment.id]
  return roof?.type === 'roof' &&
    stored?.type === 'roof-segment' &&
    stored.parentId === roof.id &&
    roof.children.includes(segment.id)
    ? roof
    : undefined
}

/** Omit just this accessory, including stale references to it; never erase a duplicate's source. */
export function withoutDormerCut(nodes: DormerScene, id: string): DormerScene {
  const view = draftOf(nodes)
  for (const node of queryNodes<RoofSegmentNode>(nodes, { type: 'roof-segment' })) {
    if (node.children.includes(id))
      view[node.id] = {
        ...node,
        children: node.children.filter((child) => child !== id),
      }
  }
  return view
}

function sceneFrame(roof: RoofNode, segment: RoofSegmentNode, nodes: DormerScene) {
  const frame = roofSegmentFrame(roof, segment)
  const parent = nodes[roof.parentId ?? '']
  if (roof.parentId && parent?.type !== 'level') return undefined
  const elevation = parent?.type === 'level' ? getLevelElevations(nodes).get(parent.id) : undefined
  const building = elevation?.buildingId ? nodes[elevation.buildingId] : undefined
  if (building && building.type !== 'building') return undefined
  const rotation = building?.type === 'building' ? building.rotation : [0, 0, 0]
  const offset = building?.type === 'building' ? building.position : [0, 0, 0]
  if (
    ![
      ...rotation,
      ...offset,
      ...roof.position,
      roof.rotation,
      ...segment.position,
      segment.rotation,
      elevation?.baseY ?? 0,
    ].every(Number.isFinite) ||
    Math.abs(rotation[0]!) > 1e-8 ||
    Math.abs(rotation[2]!) > 1e-8
  )
    return undefined
  const cos = Math.cos(rotation[1]!)
  const sin = Math.sin(rotation[1]!)
  const y = offset[1]! + (elevation?.baseY ?? 0)
  return {
    toWorld(point: Point): Point {
      const p = frame.localToLevel(point)
      return [offset[0]! + p[0] * cos + p[2] * sin, y + p[1], offset[2]! - p[0] * sin + p[2] * cos]
    },
    toLocal(point: Point): Point {
      const dx = point[0] - offset[0]!
      const dz = point[2] - offset[2]!
      return frame.levelToLocal([dx * cos - dz * sin, point[1] - y, dx * sin + dz * cos])
    },
  }
}

/** Finished covering in the entire scene, returned in the queried host's vertical frame. */
export function dormerCoveringExposure(
  position: Point,
  segment: RoofSegmentNode,
  selfId: string,
  context?: DormerExposureContext,
): DormerWindowExposure {
  const unknown = (reason: string, nodeIds: string[] = []): DormerWindowExposure => ({
    status: 'unmeasured',
    reason,
    nodeIds,
  })
  if (!position.every(Number.isFinite)) return unknown('invalid-window')
  // Legacy host-local calls have no scene to inspect. Supply only an explicit local host;
  // full-context callers must never replace a missing/invalid host with this local fallback.
  const localRoof: RoofNode = {
    object: 'node',
    type: 'roof',
    id: 'roof_dormer_exposure',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    children: [segment.id],
    support: { kind: 'level' },
  }
  // Old standalone callers supply only the surface fields, rather than a parsed scene node.
  // Keep their explicit identity: normalizing defaults here must not allocate an ID.
  const parsedLocal = context
    ? undefined
    : typeof segment.id === 'string'
      ? RoofSegmentNode.safeParse({ ...segment, parentId: localRoof.id })
      : undefined
  if (!context && !parsedLocal?.success) return unknown('invalid-host', [segment.id])
  const localSegment = parsedLocal?.success ? parsedLocal.data : segment
  const source: DormerScene = context?.nodes ?? {
    [localRoof.id]: localRoof,
    [segment.id]: localSegment,
  }
  const host = context ? segment : localSegment
  const nodes = withoutDormerCut(source, selfId)
  const roof = dormerRoofHost(nodes, host)
  if (!roof) return unknown('invalid-host', [host.id])
  const hostFrame = sceneFrame(roof, host, nodes)
  if (!hostFrame) return unknown('invalid-host', [host.id])
  const world = hostFrame.toWorld(position)
  let highest: number | null = null
  let supplying: string[] = []
  let unresolved: Extract<DormerWindowExposure, { status: 'unmeasured' }> | undefined
  for (const owner of queryNodes<RoofNode>(nodes, { type: 'roof' })) {
    for (const id of owner.children) {
      const candidate = nodes[id]
      if (!candidate) {
        unresolved ??= { status: 'unmeasured', reason: 'invalid-host', nodeIds: [id] }
        continue
      }
      if (candidate.type !== 'roof-segment') {
        unresolved ??= { status: 'unmeasured', reason: 'plugin-surface', nodeIds: [id] }
        continue
      }
      const candidateFrame = sceneFrame(owner, candidate, nodes)
      if (!candidateFrame) {
        unresolved ??= { status: 'unmeasured', reason: 'invalid-host', nodeIds: [id] }
        continue
      }
      const point = candidateFrame.toLocal(world)
      const seat = getRoofSegmentCoveringSeat(owner, candidate, [point[0], point[2]], nodes)
      if (seat.status === 'unmeasured') {
        // Native cuts only remove material. An entire uncut covering strictly below the
        // clearance threshold cannot bury this child, even if its remaining surface is unknown.
        if (seat.reason !== 'plugin-cut') {
          try {
            const triangles = buildRoofSegmentCoveringTriangles(owner, candidate, nodes)
            const vertices = triangles.flatMap((triangle) => triangle.vertices)
            if (vertices.length && vertices.every((vertex) => vertex.every(Number.isFinite))) {
              const heights = vertices.map(
                (vertex) => hostFrame.toLocal(candidateFrame.toWorld(vertex))[1],
              )
              const upper = Math.max(...heights)
              const roundoff =
                16 * Number.EPSILON * Math.max(1, Math.abs(position[1]), Math.abs(upper))
              if (Number.isFinite(upper) && upper < position[1] - 0.01 - roundoff) continue
            }
          } catch {
            // Invalid/unavailable native geometry supplies no upper-bound certificate.
          }
        }
        unresolved ??= seat
        continue
      }
      if (seat.status === 'miss') {
        if (seat.reason !== 'outside-surface')
          unresolved ??= { status: 'unmeasured', reason: seat.reason, nodeIds: [id] }
        continue
      }
      const y = hostFrame.toLocal(candidateFrame.toWorld(seat.value.position))[1]
      if (highest === null || y > highest) {
        highest = y
        supplying = [id]
      } else if (y === highest) supplying.push(id)
    }
  }
  const clearanceM = highest === null ? null : position[1] - highest
  // Roundoff at the strict native 1cm boundary must not manufacture exposure.
  const roundoff = 16 * Number.EPSILON * Math.max(1, Math.abs(position[1]), Math.abs(highest ?? 0))
  const buried = clearanceM !== null && clearanceM <= 0.01 + roundoff
  if (!buried && unresolved) return unresolved
  return {
    status: buried ? 'buried' : 'exposed',
    position,
    coveringY: highest,
    clearanceM,
    nodeIds: supplying,
  }
}
