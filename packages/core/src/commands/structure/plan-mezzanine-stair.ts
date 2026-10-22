import { planFootprintCorners } from '../../lib/plan-footprint'
import { area, difference, intersection, union } from '../../lib/polygon-boolean'
import { roomFloorPlate } from '../../lib/room-floor-plate'
import { getScaledDimensions, StairNode, StairSegmentNode } from '../../schema'
import { stairFootprintAABB } from '../../systems/stair/stair-footprint'
import {
  createSizedStairFlight,
  DEFAULT_STAIR_DESIGN_TARGETS,
} from '../../systems/stair/stair-sizing'
import {
  conflict,
  type Point,
  requireZone,
  type StructureNodes,
  type StructurePlan,
} from './shared'
import { mezzanineHostClearance } from './validate-mezzanine'

export type MezzanineStairPlacement = 'outside' | 'inside'

export type MezzanineStairPlan = StructurePlan & { stairId?: string; edgeIndex?: number }

/**
 * Plans a straight stair from the host floor up to a mezzanine deck.
 *
 * - `outside` (default): the flight stands on free host floor beside the deck
 *   and arrives flush with one of its edges.
 * - `inside`: the flight starts at an edge, climbs under the deck and arrives
 *   through an opening the deck cuts for it (`slabOpeningMode: 'destination'`),
 *   leaving at least a stair width of deck beyond the top step.
 */
export function planMezzanineStair(
  nodes: StructureNodes,
  mezzanineZoneId: string,
  placement: MezzanineStairPlacement = 'outside',
): MezzanineStairPlan {
  const zone = requireZone(nodes, mezzanineZoneId)
  const host = nodes[zone.hostZoneId ?? '']
  if (zone.floor?.support !== 'open' || host?.type !== 'zone')
    throw Error('Select a mezzanine with a host room.')
  const refuse = () =>
    conflict(
      'no-room-for-stair',
      [zone.id],
      placement === 'inside'
        ? 'No mezzanine edge has enough free deck for a straight stair to climb through.'
        : 'No mezzanine edge has enough free host floor for a straight stair.',
    )
  const slabs = Object.values(nodes).filter((node) => node.type === 'slab')
  const deck = slabs.find((node) => node.zoneIds?.includes(zone.id))
  const floor = roomFloorPlate(slabs, host.id)
  if (!deck || !floor) return refuse()
  const rise = deck.elevation - floor.elevation
  if (!(rise > 0)) return refuse()
  const defaults = createSizedStairFlight(rise)
  const stepCount = defaults.stepCount
  const preferredRun = defaults.length
  const minimumRun = stepCount * DEFAULT_STAIR_DESIGN_TARGETS.minimumGoing
  const width = defaults.width
  const landingDepth = width
  const obstacles: Point[][] = []
  for (const node of Object.values(nodes)) {
    if (node.parentId !== zone.parentId) continue
    if (node.type === 'zone' && node.floor?.support === 'open' && node.id !== zone.id)
      obstacles.push(node.polygon)
    if (node.type === 'item' && !node.asset.attachTo)
      obstacles.push(
        planFootprintCorners(node.position, getScaledDimensions(node), node.rotation[1]),
      )
    if (node.type === 'stair') {
      const box = stairFootprintAABB(node, nodes)
      if (box)
        obstacles.push([
          [box.minX, box.minZ],
          [box.maxX, box.minZ],
          [box.maxX, box.maxZ],
          [box.minX, box.maxZ],
        ])
    }
  }
  const clear = difference(mezzanineHostClearance(nodes, host), union(obstacles))
  const outside = difference(clear, zone.polygon)
  const inside = intersection(clear, zone.polygon)
  const within = (polygon: Point[], region: typeof clear) =>
    area(difference(polygon, region)) <= 1e-6 &&
    area(difference(polygon, { outer: floor.polygon, holes: floor.holes })) <= 1e-6
  const winding = Math.sign(
    zone.polygon.reduce((sum, p, i) => {
      const q = zone.polygon[(i + 1) % zone.polygon.length]!
      return sum + p[0] * q[1] - q[0] * p[1]
    }, 0),
  )
  // `direction` is the walking direction up the flight; it always points into the deck.
  const candidates: { edgeIndex: number; edgePoint: Point; direction: Point; freeRun: number }[] =
    []
  const extent = Math.hypot(
    Math.max(...host.polygon.map(([x]) => x)) - Math.min(...host.polygon.map(([x]) => x)),
    Math.max(...host.polygon.map(([, z]) => z)) - Math.min(...host.polygon.map(([, z]) => z)),
  )
  const requiredDepth = placement === 'inside' ? minimumRun + landingDepth : minimumRun
  for (const [edgeIndex, start] of zone.polygon.entries()) {
    const end = zone.polygon[(edgeIndex + 1) % zone.polygon.length]!
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    if (length < width) continue
    const tangent: Point = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
    const direction: Point = [-winding * tangent[1], winding * tangent[0]]
    for (const along of [...new Set([length / 2, width / 2, length - width / 2])]) {
      const edgePoint: Point = [start[0] + tangent[0] * along, start[1] + tangent[1] * along]
      // A strip of the stair's width from the edge, `from` to `to` metres into the deck.
      const strip = (from: number, to: number): Point[] =>
        [
          [-width / 2, from],
          [width / 2, from],
          [width / 2, to],
          [-width / 2, to],
        ].map(([x, z]) => [
          edgePoint[0] + tangent[0] * x! + direction[0] * z!,
          edgePoint[1] + tangent[1] * x! + direction[1] * z!,
        ])
      const fits =
        placement === 'inside'
          ? (depth: number) => within(strip(0, depth), inside)
          : (depth: number) => within(strip(-depth, 0), outside)
      if (!fits(requiredDepth)) continue
      // The bottom step of an inside stair needs free host floor in front of it.
      if (placement === 'inside' && !within(strip(-width, 0), outside)) continue
      let lo = requiredDepth,
        hi = extent
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
      }
      candidates.push({ edgeIndex, edgePoint, direction, freeRun: lo })
    }
  }
  const best = candidates.sort((a, b) => b.freeRun - a.freeRun)[0]
  if (!best) return refuse()
  const run = Math.min(
    preferredRun,
    placement === 'inside' ? best.freeRun - landingDepth : best.freeRun,
  )
  const bottom: Point =
    placement === 'inside'
      ? best.edgePoint
      : [best.edgePoint[0] - best.direction[0] * run, best.edgePoint[1] - best.direction[1] * run]
  const stair = StairNode.parse({
    parentId: zone.parentId,
    name: 'Mezzanine stair',
    uniformRisers: true,
    fromLevelId: zone.parentId,
    supportSlabId: floor.id,
    deckSlabId: deck.id,
    slabOpeningMode: placement === 'inside' ? 'destination' : 'none',
    width,
    stepCount,
    position: [bottom[0] + 0, 0, bottom[1] + 0],
    rotation: Math.atan2(best.direction[0], best.direction[1]) + 0,
  })
  const segment = StairSegmentNode.parse({
    ...defaults,
    parentId: stair.id,
    height: rise,
    length: run,
    stepCount,
  })
  stair.children = [segment.id]
  return {
    stairId: stair.id,
    edgeIndex: best.edgeIndex,
    changes: [
      { op: 'create', node: stair },
      { op: 'create', node: segment },
    ],
  }
}
