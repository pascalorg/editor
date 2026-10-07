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

export type MezzanineStairPlan = StructurePlan & { stairId?: string; edgeIndex?: number }

export function planMezzanineStair(
  nodes: StructureNodes,
  mezzanineZoneId: string,
): MezzanineStairPlan {
  const zone = requireZone(nodes, mezzanineZoneId)
  const host = nodes[zone.hostZoneId ?? '']
  if (zone.floor?.support !== 'open' || host?.type !== 'zone')
    throw Error('Select a mezzanine with a host room.')
  const refuse = () =>
    conflict(
      'no-room-for-stair',
      [zone.id],
      'No mezzanine edge has enough free host floor for a straight stair.',
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
  const obstacles: Point[][] = []
  for (const node of Object.values(nodes)) {
    if (node.parentId !== zone.parentId) continue
    if (node.type === 'zone' && node.floor?.support === 'open') obstacles.push(node.polygon)
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
  const free = difference(mezzanineHostClearance(nodes, host), union(obstacles))
  const winding = Math.sign(
    zone.polygon.reduce((sum, p, i) => {
      const q = zone.polygon[(i + 1) % zone.polygon.length]!
      return sum + p[0] * q[1] - q[0] * p[1]
    }, 0),
  )
  const candidates: { edgeIndex: number; arrival: Point; normal: Point; freeRun: number }[] = []
  const extent = Math.hypot(
    Math.max(...host.polygon.map(([x]) => x)) - Math.min(...host.polygon.map(([x]) => x)),
    Math.max(...host.polygon.map(([, z]) => z)) - Math.min(...host.polygon.map(([, z]) => z)),
  )
  for (const [edgeIndex, start] of zone.polygon.entries()) {
    const end = zone.polygon[(edgeIndex + 1) % zone.polygon.length]!
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    if (length < width) continue
    const tangent: Point = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
    const normal: Point = [winding * tangent[1], -winding * tangent[0]]
    for (const along of [...new Set([length / 2, width / 2, length - width / 2])]) {
      const arrival: Point = [start[0] + tangent[0] * along, start[1] + tangent[1] * along]
      const footprint = (depth: number): Point[] =>
        [
          [-width / 2, 0],
          [width / 2, 0],
          [width / 2, depth],
          [-width / 2, depth],
        ].map(([x, z]) => [
          arrival[0] + tangent[0] * x! + normal[0] * z!,
          arrival[1] + tangent[1] * x! + normal[1] * z!,
        ])
      const fits = (depth: number) => {
        const polygon = footprint(depth)
        return (
          area(difference(polygon, free)) <= 1e-6 &&
          area(difference(polygon, { outer: floor.polygon, holes: floor.holes })) <= 1e-6 &&
          area(intersection(polygon, zone.polygon)) <= 1e-6
        )
      }
      if (!fits(minimumRun)) continue
      let lo = minimumRun,
        hi = extent
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
      }
      candidates.push({ edgeIndex, arrival, normal, freeRun: lo })
    }
  }
  const best = candidates.sort((a, b) => b.freeRun - a.freeRun)[0]
  if (!best) return refuse()
  const run = Math.min(preferredRun, best.freeRun)
  const stair = StairNode.parse({
    parentId: zone.parentId,
    name: 'Mezzanine stair',
    uniformRisers: true,
    fromLevelId: zone.parentId,
    supportSlabId: floor.id,
    deckSlabId: deck.id,
    width,
    stepCount,
    position: [
      best.arrival[0] + best.normal[0] * run + 0,
      0,
      best.arrival[1] + best.normal[1] * run + 0,
    ],
    rotation: Math.atan2(-best.normal[0], -best.normal[1]) + 0,
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
