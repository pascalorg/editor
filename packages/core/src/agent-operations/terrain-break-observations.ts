import { levelBuildingId } from '../building/level-duplication'
import { containsPoint, type MultiPolygon, type Ring } from '../lib/polygon-boolean'
import { terrainBreakHeightAt, terrainBreaksOf } from '../lib/terrain-breaks'
import type { TerrainField } from '../lib/terrain-field'
import { persistedTerrainFieldOf } from '../lib/terrain-source-persisted'
import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, BuildingNode, TerrainBreakNode } from '../schema'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { levelIdOf } from './scene-queries'
import type { SceneNodes } from './types'
import { slabSurfaces } from './unguarded-drop-observations'

type Point = [number, number]
type Footprint = { node: AnyNode; building: BuildingNode; solid: MultiPolygon }

export type TerrainBreakObservation = {
  type: 'terrain_break_straddled'
  severity: 'info'
  nodeId: string
  breakId: string
  nodeIds: string[]
  coordinateFrame: 'site'
  sides: ['left', 'right']
  sideHeightRanges: { left: { minM: number; maxM: number }; right: { minM: number; maxM: number } }
  dropM: { minM: number; maxM: number }
  sampling: { method: 'break_intervals'; maxStepM: number; sampleCount: number }
  message: string
}

const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]

function siteRing(ring: Ring, building: BuildingNode): Ring {
  const cos = Math.cos(building.rotation[1])
  const sin = Math.sin(building.rotation[1])
  return ring.map(([x, z]) => [
    cos * x + sin * z + building.position[0],
    -sin * x + cos * z + building.position[2],
  ])
}

function siteSolid(footprint: Footprint): MultiPolygon {
  return footprint.solid.map(({ outer, holes }) => ({
    outer: siteRing(outer, footprint.building),
    holes: holes.map((hole) => siteRing(hole, footprint.building)),
  }))
}

function footprints(nodes: SceneNodes): Footprint[] {
  const result: Footprint[] = []
  for (const surface of slabSurfaces(nodes as Record<string, AnyNode>)) {
    const building = surface.buildingId ? nodes[surface.buildingId] : undefined
    if (building?.type === 'building' && !building.rotation[0] && !building.rotation[2])
      result.push({ node: surface.slab, building, solid: surface.solid })
  }
  for (const node of queryNodes(nodes, { type: 'wall' })) {
    if (node.type !== 'wall') continue
    const levelId = levelIdOf(nodes, node.id)
    const level = levelId ? nodes[levelId] : undefined
    const buildingId = level?.type === 'level' ? levelBuildingId(nodes, level) : null
    const building = buildingId ? nodes[buildingId] : undefined
    if (!levelId || building?.type !== 'building' || building.rotation[0] || building.rotation[2])
      continue
    const walls = queryNodes(nodes, { type: 'wall' }).filter(
      (candidate): candidate is AnyNode & { type: 'wall' } =>
        candidate.type === 'wall' && levelIdOf(nodes, candidate.id) === levelId,
    )
    const outer = getWallPlanFootprint(node, calculateLevelMiters(walls)).map(
      ({ x, y }): Point => [x, y],
    )
    if (outer.length >= 3) result.push({ node, building, solid: [{ outer, holes: [] }] })
  }
  return result
}

function segmentParameters(from: Point, to: Point, solid: MultiPolygon): number[] {
  const direction = subtract(to, from)
  const values = [0, 1]
  for (const polygon of solid)
    for (const ring of [polygon.outer, ...polygon.holes])
      for (let index = 0; index < ring.length; index++) {
        const start = ring[index]
        const end = ring[(index + 1) % ring.length]
        if (!start || !end) continue
        const edge = subtract(end, start)
        const denominator = cross(direction, edge)
        if (Math.abs(denominator) < 1e-12) continue
        const offset = subtract(start, from)
        const t = cross(offset, edge) / denominator
        const u = cross(offset, direction) / denominator
        if (t > 0 && t < 1 && u >= 0 && u <= 1) values.push(t)
      }
  return [...new Set(values)].sort((a, b) => a - b)
}

function straddledIntervals(terrainBreak: TerrainBreakNode, solid: MultiPolygon): [Point, Point][] {
  const intervals: [Point, Point][] = []
  for (let index = 1; index < terrainBreak.line.length; index++) {
    const from = terrainBreak.line[index - 1]
    const to = terrainBreak.line[index]
    if (!from || !to) continue
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const normal: Point = [-(to[1] - from[1]) / length, (to[0] - from[0]) / length]
    const values = segmentParameters(from, to, solid)
    for (let span = 1; span < values.length; span++) {
      const begin = values[span - 1]
      const end = values[span]
      if (begin === undefined || end === undefined || (end - begin) * length < 1e-6) continue
      const midpoint = mix(from, to, (begin + end) / 2)
      const probe = 1e-5
      const left: Point = [midpoint[0] + normal[0] * probe, midpoint[1] + normal[1] * probe]
      const right: Point = [midpoint[0] - normal[0] * probe, midpoint[1] - normal[1] * probe]
      if (containsPoint(solid, left) && containsPoint(solid, right))
        intervals.push([mix(from, to, begin), mix(from, to, end)])
    }
  }
  return intervals
}

function intervalHeights(
  terrainBreak: TerrainBreakNode,
  field: TerrainField,
  intervals: [Point, Point][],
) {
  const left: number[] = []
  const right: number[] = []
  const drops: number[] = []
  for (const [from, to] of intervals) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.25))
    for (let index = 0; index <= steps; index++) {
      const [x, z] = mix(from, to, index / steps)
      const leftM = terrainBreakHeightAt(field, terrainBreak, 'left', x, z)
      const rightM = terrainBreakHeightAt(field, terrainBreak, 'right', x, z)
      left.push(leftM)
      right.push(rightM)
      drops.push(Math.abs(leftM - rightM))
    }
  }
  const range = (values: number[]) => ({ minM: Math.min(...values), maxM: Math.max(...values) })
  return {
    sideHeightRanges: { left: range(left), right: range(right) },
    dropM: range(drops),
    sampling: { method: 'break_intervals' as const, maxStepM: 0.25, sampleCount: drops.length },
  }
}

export function terrainBreakObservations(nodes: SceneNodes): TerrainBreakObservation[] {
  const result: TerrainBreakObservation[] = []
  const sites = queryNodes(nodes, { type: 'site' }).filter(
    (site) => site.type === 'site' && terrainBreaksOf(site, nodes).length > 0,
  )
  if (!sites.length) return result
  const surfaces = footprints(nodes)
  for (const site of sites) {
    if (site.type !== 'site') continue
    const field = persistedTerrainFieldOf(site, nodes)
    if (!field) continue
    for (const terrainBreak of terrainBreaksOf(site, nodes))
      for (const footprint of surfaces) {
        if (footprint.building.parentId !== site.id) continue
        const intervals = straddledIntervals(terrainBreak, siteSolid(footprint))
        if (!intervals.length) continue
        const facts = intervalHeights(terrainBreak, field, intervals)
        result.push({
          type: 'terrain_break_straddled',
          severity: 'info',
          nodeId: footprint.node.id,
          breakId: terrainBreak.id,
          nodeIds: [footprint.node.id, terrainBreak.id],
          coordinateFrame: 'site',
          sides: ['left', 'right'],
          ...facts,
          message: `${footprint.node.type} ${footprint.node.name ?? footprint.node.id} straddles terrain break ${terrainBreak.name ?? terrainBreak.id}: ground on left ${facts.sideHeightRanges.left.minM.toFixed(3)}–${facts.sideHeightRanges.left.maxM.toFixed(3)} m, right ${facts.sideHeightRanges.right.minM.toFixed(3)}–${facts.sideHeightRanges.right.maxM.toFixed(3)} m; drop ${facts.dropM.minM.toFixed(3)}–${facts.dropM.maxM.toFixed(3)} m.`,
        })
      }
  }
  return result
}
