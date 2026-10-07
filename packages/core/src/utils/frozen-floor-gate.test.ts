import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { slabFootprint } from '../lib/floor-plates'
import { area, containsPoint, difference, distanceToBoundary, union } from '../lib/polygon-boolean'
import { getRenderableSlabPolygon } from '../lib/slab-polygon'
import type { AnyNode, AnyNodeId, ElevatorNode, SlabNode, WallNode } from '../schema'
import { getWallSurfacePolygon, isCurvedWall } from '../systems/wall/wall-curve'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { getWallMiterBoundaryPoints } from '../systems/wall/wall-mitering'
import { materializeLegacyAutoOpenings } from './owned-floor-opening-migration'
import {
  healSceneNodes,
  migrateCeilingRoomLinks,
  migrateFloorPlates,
  migrateRoomZones,
  migrateSlabSlots,
  migrateVerticalSceneNodes,
  normalizeLegacyStructure,
} from './scene-migrations'

type Fixture = {
  sceneId: string
  rootNodeIds: AnyNodeId[]
  nodes: Record<string, AnyNode>
  areas: { levelId: string; beforeVisible: number; afterVisible: number }[]
  gaps: {
    levelId: string
    wallId: string
    plateIds: string[]
    sampleStations: number[]
    faces: { face: 'a' | 'b'; uncoveredSamples: number[] }[]
  }[]
}
const directory = new URL('../lib/__fixtures__/plate-corpus/frozen-gate/', import.meta.url)
const fixtures: Fixture[] = readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(new URL(file, directory), 'utf8')))
function prefix(nodes: Record<string, unknown>) {
  return migrateCeilingRoomLinks(
    migrateRoomZones(
      migrateVerticalSceneNodes(healSceneNodes(normalizeLegacyStructure(nodes)).nodes).nodes,
    ).nodes,
  ).nodes as Record<string, AnyNode>
}
function visible(nodes: Record<string, AnyNode>, levelId: string) {
  const children = Object.values(nodes).filter((node) => node.parentId === levelId)
  const walls = children.filter((node): node is WallNode => node.type === 'wall')
  const slabs = children.filter((node): node is SlabNode => node.type === 'slab')
  const miters = calculateLevelMiters(walls)
  return difference(
    union(
      slabs.map((slab) => ({
        outer: getRenderableSlabPolygon(slab, { walls, siblingSlabs: slabs }),
        holes: slab.holes ?? [],
      })),
    ),
    union(
      walls.map((wall) =>
        getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
      ),
    ),
  )
}

test.each(
  fixtures.filter((fixture) => fixture.areas.length),
)('$sceneId M4 preserves visible area; subsequent loss is exactly legacy stair openings', (fixture) => {
  const before = prefix(fixture.nodes)
  const plates = migrateFloorPlates(before).nodes as Record<string, AnyNode>
  const ensured = { nodes: materializeLegacyAutoOpenings(plates) as Record<string, AnyNode> }
  for (const row of fixture.areas) {
    const original = visible(before, row.levelId)
    const migrated = visible(plates, row.levelId)
    const opened = visible(ensured.nodes, row.levelId)
    expect(Math.abs(area(migrated) - area(original))).toBeLessThanOrEqual(area(original) * 0.01)
    expect(area(original)).toBeCloseTo(row.beforeVisible, 2)
    expect(area(opened)).toBeCloseTo(row.afterVisible, 2)
    const newHoles = Object.values(ensured.nodes).flatMap((node) => {
      if (node.type !== 'slab' || node.parentId !== row.levelId) return []
      const previous = plates[node.id] as SlabNode
      return node.holes.slice(previous.holes?.length ?? 0)
    })
    expect(area(difference(difference(migrated, opened), union(newHoles)))).toBeLessThan(0.001)
  }
  expect(materializeLegacyAutoOpenings(ensured.nodes)).toBe(ensured.nodes)
})

test.each(
  fixtures.filter((fixture) => fixture.gaps.length),
)('$sceneId frozen gap samples are covered by stored plates before missing openings are ensured', (fixture) => {
  const plates = migrateFloorPlates(prefix(fixture.nodes)).nodes as Record<string, AnyNode>
  const ensured = materializeLegacyAutoOpenings(plates) as Record<string, AnyNode>
  for (const gap of fixture.gaps) {
    const wall = plates[gap.wallId] as WallNode
    const walls = Object.values(plates).filter(
      (node): node is WallNode => node.type === 'wall' && node.parentId === gap.levelId,
    )
    const ends = getWallMiterBoundaryPoints(wall, calculateLevelMiters(walls))!
    const count = isCurvedWall(wall) ? 24 : 1
    const polygon = getWallSurfacePolygon(wall, count, ends)
    const lines = { a: polygon.slice(count + 1).reverse(), b: polygon.slice(0, count + 1) }
    const owners = Object.values(plates).filter(
      (node): node is SlabNode => node.type === 'slab' && node.parentId === gap.levelId,
    )
    const geometry = owners.map(slabFootprint)
    const additions = owners
      .map((plate) => plate.id)
      .flatMap((id) => (ensured[id] as SlabNode).holes.slice((plates[id] as SlabNode).holes.length))
    for (const face of gap.faces)
      for (const index of face.uncoveredSamples) {
        const t = gap.sampleStations[index]!
        const segment = Math.min(Math.floor(t * count), count - 1)
        const fraction = t * count - segment
        const a = lines[face.face][segment]!,
          b = lines[face.face][segment + 1]!
        const point: [number, number] = [a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction]
        expect(containsPoint(geometry, point) || distanceToBoundary(geometry, point) <= 0.005).toBe(
          true,
        )
        expect(
          containsPoint(
            additions.map((outer) => ({ outer, holes: [] })),
            point,
          ),
        ).toBe(true)
      }
  }
})

test.each(
  fixtures.filter(({ sceneId }) => ['scene-19', 'scene-10'].includes(sceneId)),
)('$sceneId level-parented elevator openings agree with client building reparenting and preserve saved holes', (fixture) => {
  const before = migrateSlabSlots(migrateFloorPlates(prefix(fixture.nodes)).nodes).nodes as Record<
    string,
    AnyNode
  >
  const bytes = JSON.stringify(before)
  const clientParents = { ...before }
  const legacy = Object.values(before).filter(
    (node): node is ElevatorNode =>
      node.type === 'elevator' && before[node.parentId!]?.type === 'level',
  )
  expect(legacy.length).toBeGreaterThan(0)
  for (const elevator of legacy) {
    const building = Object.values(before).find(
      (node) => node.type === 'building' && node.children.includes(elevator.parentId as AnyNodeId),
    )!
    clientParents[elevator.id] = { ...elevator, parentId: building.id }
  }
  const server = materializeLegacyAutoOpenings(before) as Record<string, AnyNode>,
    client = materializeLegacyAutoOpenings(clientParents) as Record<string, AnyNode>
  expect(JSON.stringify(before)).toBe(bytes)
  expect(
    Object.values(server)
      .filter((node) => node.type === 'slab')
      .map((node) => node.holeMetadata),
  ).toEqual(
    Object.values(client)
      .filter((node) => node.type === 'slab')
      .map((node) => node.holeMetadata),
  )
  for (const elevator of legacy) {
    expect(
      Object.values(server).some(
        (node) =>
          node.type === 'slab' && node.holeMetadata?.some((m) => m.elevatorId === elevator.id),
      ),
    ).toBe(fixture.sceneId !== 'scene-19')
  }
  for (const node of Object.values(before)) {
    if (node.type !== 'slab') continue
    expect((server[node.id] as SlabNode).holes.slice(0, node.holes.length)).toEqual(node.holes)
  }
  expect(materializeLegacyAutoOpenings(server)).toBe(server)
})
