import { area, difference, intersection, union } from '../lib/polygon-boolean'
import type { CirculationGraph, CirculationNonSpace } from './circulation-graph'
import { doorSidePoints, keyOf, type Pt, spaceAt, spaceRegion } from './circulation-spaces'
import type { SceneNodes } from './types'

/** A space is a void when most of its plan is open air rather than walking floor. */
const VOID_SHARE = 0.5

/** A slab this near a wall of the level hangs off the building; further, it is a floor of its own. */
const ATTACHED_WITHIN_M = 0.3

function pointSegmentDistance(point: Pt, start: Pt, end: Pt) {
  const [dx, dz] = [end[0] - start[0], end[1] - start[1]]
  const along = dx * dx + dz * dz
  const t = along
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / along))
    : 0
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dz))
}

const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt) {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

function attachedToWall(polygon: readonly Pt[], walls: readonly [Pt, Pt][]) {
  return walls.some(([start, end]) =>
    polygon.some((point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? segmentDistance(start, end, point, next) <= ATTACHED_WITHIN_M : false
    }),
  )
}

/** The spaces a door or a window opens onto, by graph key. */
function openedOnto(scene: SceneNodes, graph: CirculationGraph) {
  const floors = new Map<string, CirculationGraph['floors'][number]>(
    graph.floors.map((floor) => [floor.id, floor]),
  )
  const keys = new Set<string>()
  for (const node of Object.values(scene)) {
    if (node.type !== 'door' && node.type !== 'window') continue
    const wall = scene[node.wallId ?? node.parentId ?? '']
    const floor = wall?.type === 'wall' ? floors.get(wall.parentId ?? '') : undefined
    if (wall?.type !== 'wall' || !floor) continue
    for (const point of doorSidePoints(wall, node.position[0]))
      keys.add(keyOf(spaceAt(floor, point)))
  }
  return keys
}

/**
 * The graph's spaces that nobody walks to: a void (a lantern void open through a floor opening, a
 * lightwell open to the sky over no floor) and an outdoor slab outside the enclosed footprint (a
 * balcony slab) hanging off a wall that no door or window opens onto. They are not destinations, so a missing route
 * to one is not a missing route to a room.
 */
export function circulationNonSpaces(scene: SceneNodes, graph: CirculationGraph) {
  const result = new Map<string, CirculationNonSpace>()
  let opened: Set<string> | undefined
  for (const node of graph.nodes.values()) {
    if (node.kind !== 'room' && node.kind !== 'zone' && node.kind !== 'floor') continue
    const floor = graph.floors.find((candidate) => candidate.id === node.levelId)
    const region = spaceRegion(scene, graph, node)
    if (!(floor && region)) continue
    const total = area([region])
    if (total < 1e-6) continue
    const cuts = [...floor.voids, ...floor.shafts].map((outer) => ({ outer, holes: [] }))
    if (cuts.length && area(intersection(region, cuts)) >= total * VOID_SHARE) {
      result.set(node.id, 'void')
      continue
    }
    const source = node.sourceId ? scene[node.sourceId] : undefined
    // A floorless room is a named unmeasured limit (hasFloor false), not open sky.
    if (source?.type === 'zone' && source.hasFloor !== false && source.hasCeiling === false) {
      const walking = difference(
        union(floor.slabs.map((slab) => ({ outer: slab.polygon, holes: slab.holes }))),
        cuts,
      )
      if (area(intersection(region, walking)) < total * VOID_SHARE) result.set(node.id, 'void')
      continue
    }
    const slab =
      node.kind === 'floor' && !node.sourceId
        ? floor.slabs.find((candidate) => node.id === `floor:${floor.id}:${candidate.id}`)
        : undefined
    if (
      !slab ||
      !floor.interior.length ||
      area(intersection(region, floor.interior)) > 1e-6 ||
      !attachedToWall(slab.polygon, floor.walls)
    )
      continue
    opened ??= openedOnto(scene, graph)
    if (!opened.has(node.id)) result.set(node.id, 'outdoor-slab')
  }
  return result
}
