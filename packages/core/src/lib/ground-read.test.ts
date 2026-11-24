import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  FLAT_GROUND,
  getRenderableSlabPolygon,
  ItemNode,
  LevelNode,
  PlantingNode,
  planPlanting,
  resolvePlantingAccept,
  resolvePlantingGround,
  resolveSiteGround,
  SiteNode,
  SlabNode,
  WallNode,
  withHostedCutterHoles,
} from '../index'

type Point = [number, number]
const rectangle = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const site = SiteNode.parse({ id: 'site_ground' })
const scene = (...nodes: AnyNode[]) =>
  Object.fromEntries(
    nodes.map((node) => [
      node.id,
      'children' in node
        ? {
            ...node,
            children: nodes.filter((child) => child.parentId === node.id).map((child) => child.id),
          }
        : node,
    ]),
  ) as Record<string, AnyNode>

// Provenance: main's rendered Site plane is -0.05; its slab schema defines elevation
// as the top and thickness downward. The quarter-turn examples are analytical Site
// coordinates, not results copied from the frame or ground implementation.
describe('garden ground on main', () => {
  test('a flat Site uses its rendered plane without changing the generator fixture datum', () => {
    const ground = resolveSiteGround(site.id, scene(site))
    expect(ground.heightAt(0, 0)).toBe(-0.05)
    expect(ground.heightAt(12, -8)).toBe(-0.05)
    expect(FLAT_GROUND.heightAt(12, -8)).toBe(0)
  })

  test('reads slab tops, not undersides, and holes reveal the next support or the Site', () => {
    const lower = SlabNode.parse({
      id: 'slab_lower',
      parentId: site.id,
      polygon: rectangle(-4, -4, 4, 4),
      elevation: 0.4,
      thickness: 0.3,
    })
    const upper = SlabNode.parse({
      id: 'slab_upper_support',
      parentId: site.id,
      polygon: rectangle(-3, -3, 3, 3),
      holes: [rectangle(-1, -1, 1, 1)],
      elevation: 1.2,
      thickness: 0.8,
    })
    const ground = resolveSiteGround(site.id, scene(site, lower, upper))
    expect(ground.heightAt(2, 0)).toBe(1.2)
    expect(ground.heightAt(0, 0)).toBe(0.4)
    expect(ground.heightAt(3.5, 0)).toBe(0.4)
    expect(ground.heightAt(5, 0)).toBe(-0.05)
    expect(resolveSiteGround(site.id, scene(site, upper)).heightAt(0, 0)).toBe(-0.05)
    expect(
      resolveSiteGround(site.id, scene(site, lower, { ...upper, thickness: 0.1 })).heightAt(2, 0),
    ).toBe(1.2)
    expect(ground.regionAt?.(2, 0)).not.toBe(ground.regionAt?.(0, 0))
  })

  test('coplanar neighboring slabs do not invent a vertical face at their seam', () => {
    const west = SlabNode.parse({
      id: 'slab_west',
      parentId: site.id,
      polygon: rectangle(-2, -2, 0, 2),
      elevation: 0.5,
    })
    const east = SlabNode.parse({
      id: 'slab_east',
      parentId: site.id,
      polygon: rectangle(0, -2, 2, 2),
      elevation: 0.5,
    })
    const ground = resolveSiteGround(site.id, scene(site, west, east))
    expect(ground.heightAt(-0.1, 0)).toBe(0.5)
    expect(ground.heightAt(0.1, 0)).toBe(0.5)
    expect(ground.regionAt?.(-0.1, 0)).toBe(ground.regionAt?.(0.1, 0))
  })

  test('supports the rendered wall-band extension of a manual slab, not only its stored ring', () => {
    const building = BuildingNode.parse({ id: 'building_wall_band', parentId: site.id })
    const level = LevelNode.parse({ id: 'level_wall_band', parentId: building.id, level: 0 })
    const slab = SlabNode.parse({
      id: 'slab_wall_band',
      parentId: level.id,
      polygon: rectangle(0, 0, 4, 3),
      elevation: 0.05,
      thickness: 0.05,
      autoFromWalls: false,
    })
    const walls = [
      WallNode.parse({
        id: 'wall_band_front',
        parentId: level.id,
        start: [0, 0],
        end: [4, 0],
        thickness: 0.1,
      }),
      WallNode.parse({
        id: 'wall_band_right',
        parentId: level.id,
        start: [4, 0],
        end: [4, 3],
        thickness: 0.1,
      }),
      WallNode.parse({
        id: 'wall_band_rear',
        parentId: level.id,
        start: [4, 3],
        end: [0, 3],
        thickness: 0.1,
      }),
      WallNode.parse({
        id: 'wall_band_left',
        parentId: level.id,
        start: [0, 3],
        end: [0, 0],
        thickness: 0.3,
      }),
    ]
    // Fixture control through main's public render polygon. The independent
    // expected facade is centreline x=0 minus half the 0.3 m wall thickness.
    const rendered = getRenderableSlabPolygon(slab, { walls, siblingSlabs: [] })
    expect(Math.min(...rendered.map(([x]) => x))).toBeCloseTo(-0.15, 9)
    const ground = resolveSiteGround(site.id, scene(site, building, level, slab, ...walls))
    expect(ground.heightAt(-0.1, 1.5)).toBe(0.05)
    expect(ground.heightAt(-0.2, 1.5)).toBe(-0.05)
    expect(ground.heightAt(2, 1.5)).toBe(0.05)

    const thinWalls = walls.map((wall) => ({ ...wall, thickness: 0.1 }))
    const changed = resolveSiteGround(site.id, scene(site, building, level, slab, ...thinWalls))
    expect(changed.heightAt(-0.1, 1.5)).toBe(-0.05)
  })

  test('a hosted through-cutter opens the rendered slab for ground and a contained planting crown', () => {
    const slab = SlabNode.parse({
      id: 'slab_cut_support',
      parentId: site.id,
      polygon: rectangle(0, 0, 10, 10),
      elevation: 1,
      thickness: 1,
      holes: [],
    })
    const cutter = ItemNode.parse({
      id: 'item_ground_cut',
      parentId: slab.id,
      position: [5, 0, 5],
      asset: {
        id: 'ground-cut-fixture',
        category: 'test',
        name: 'Ground opening',
        thumbnail: '',
        src: 'https://example.invalid/ground-cut.glb',
        dimensions: [2, 2, 2],
      },
      source: {
        kind: 'script',
        script: 'a'.repeat(64),
        artifact: 'b'.repeat(64),
        manifest: {
          bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
          triangles: 12,
          cutters: [{ host: 'mounted', polygon: rectangle(-1, -1, 1, 1), minY: -1, maxY: 1 }],
        },
      },
    })
    const bed = PlantingNode.parse({ id: 'planting_cut_support', parentId: site.id, area: 12 })
    const nodes = scene(site, slab, cutter, bed)
    // A two-metre cutter centred at (5,5) gives [4,6]², without persisting a hole.
    expect(withHostedCutterHoles(slab, nodes).holes).toContainEqual(rectangle(4, 4, 6, 6))
    expect(slab.holes).toEqual([])
    const ground = resolveSiteGround(site.id, nodes)
    const accept = resolvePlantingAccept(bed, nodes)
    expect(ground.heightAt(5, 5)).toBe(-0.05)
    expect(ground.heightAt(3, 5)).toBe(1)
    expect(ground.regionAt?.(5, 5)).not.toBe(ground.regionAt?.(3, 5))
    expect(accept(5, 5, 0.2)).toBe(true)
    expect(accept(4.1, 5, 0.2)).toBe(false)
    expect(accept(3, 5, 0.2)).toBe(false)

    const moved = scene(site, slab, { ...cutter, position: [7, 0, 5] }, bed)
    expect(resolveSiteGround(site.id, moved).heightAt(5, 5)).toBe(1)
    expect(resolveSiteGround(site.id, moved).heightAt(7, 5)).toBe(-0.05)
    expect(resolvePlantingAccept(bed, moved)(5, 5, 0.2)).toBe(false)
    expect(resolvePlantingAccept(bed, moved)(7, 5, 0.2)).toBe(true)
    const removed = scene(site, slab, bed)
    expect(resolveSiteGround(site.id, removed).heightAt(5, 5)).toBe(1)
    expect(resolvePlantingAccept(bed, removed)(5, 5, 0.2)).toBe(false)

    const above = scene(site, slab, { ...cutter, position: [5, 2, 5] }, bed)
    expect(resolveSiteGround(site.id, above).heightAt(5, 5)).toBe(1)
    expect(resolvePlantingAccept(bed, above)(5, 5, 0.2)).toBe(false)
  })

  test('composes building yaw, translation and level offset, excluding upper floors and other Sites', () => {
    const building = BuildingNode.parse({
      id: 'building_ground',
      parentId: site.id,
      position: [10, 1.5, -3],
      rotation: [0, Math.PI / 2, 0],
      groundLevelId: 'level_ground',
    })
    const level = LevelNode.parse({
      id: 'level_ground',
      parentId: building.id,
      level: 0,
      height: 3,
      baseElevation: 0.4,
    })
    const upper = LevelNode.parse({
      id: 'level_roof',
      parentId: building.id,
      level: 1,
      height: 3,
    })
    const floor = SlabNode.parse({
      id: 'slab_ground_floor',
      parentId: level.id,
      polygon: rectangle(0, 0, 6, 4),
      holes: [rectangle(2, 1, 4, 3)],
      elevation: 0.6,
      thickness: 0.2,
    })
    const roof = SlabNode.parse({
      id: 'slab_roof',
      parentId: upper.id,
      polygon: rectangle(-5, -5, 12, 12),
      elevation: 0.9,
    })
    const otherSite = SiteNode.parse({ id: 'site_unrelated' })
    const foreign = SlabNode.parse({
      id: 'slab_foreign',
      parentId: otherSite.id,
      polygon: rectangle(-100, -100, 100, 100),
      elevation: 20,
    })
    const nodes = scene(site, building, level, upper, floor, roof, otherSite, foreign)
    const ground = resolveSiteGround(site.id, nodes)
    // Local (1,1) -> (11,-4), top 1.5 + 0.4 + 0.6.
    expect(ground.heightAt(11, -4)).toBeCloseTo(2.5, 9)
    // Local (3,2) is the hole, local (9,2) is beneath upper-floor-only coverage.
    expect(ground.heightAt(12, -6)).toBe(-0.05)
    expect(ground.heightAt(12, -12)).toBe(-0.05)
    expect(ground.heightAt(1, 1)).toBe(-0.05)
    expect(resolveSiteGround(otherSite.id, nodes).heightAt(11, -4)).toBe(20)

    const bed = PlantingNode.parse({ area: 12, parentId: site.id })
    const accept = resolvePlantingAccept(bed, nodes, FLAT_GROUND)
    expect(accept(11, -4, 0.2)).toBe(false)
    expect(accept(12, -6, 0.2)).toBe(true)
    expect(accept(11.1, -6, 0.2)).toBe(false)
    expect(accept(12, -12, 0.2)).toBe(true)
  })

  test('keeps main’s existing persisted single-grid terrain without importing lab terrain nodes', () => {
    const field = createTerrainField({ origin: [0, 0], cols: 3, rows: 3, spacing: 1, step: 0.01 })
    // Plane y = 1 + x/2 + z/4, exact on either triangulation of each cell.
    field.heights.set([100, 150, 200, 125, 175, 225, 150, 200, 250])
    const sculpted = { ...site, terrain: encodeTerrainField(field) }
    const ground = resolveSiteGround(site.id, scene(sculpted))
    expect(ground.heightAt(0.5, 1.5)).toBeCloseTo(1.625, 9)
    expect(ground.heightAt(1.5, 0.5)).toBeCloseTo(1.875, 9)
  })

  test('planting roots use the same slab height while lawns remain plantable', () => {
    const lawn = SlabNode.parse({
      id: 'slab_lawn',
      parentId: site.id,
      polygon: rectangle(-20, -20, 20, 20),
      elevation: 0.8,
      metadata: { flatwork: 'lawn' },
    })
    const bed = PlantingNode.parse({ id: 'planting_ground', parentId: site.id, area: 12, seed: 19 })
    const nodes = scene(site, lawn, bed)
    const ground = resolvePlantingGround(bed, nodes)
    const raised = planPlanting(bed, ground, resolvePlantingAccept(bed, nodes, ground))
    const flat = planPlanting(bed, FLAT_GROUND)
    expect(raised.placements.length).toBeGreaterThan(0)
    expect(raised.placements.length).toBe(flat.placements.length)
    raised.placements.forEach((plant, i) => {
      const reference = flat.placements[i]!
      expect([plant.x, plant.z, plant.species]).toEqual([
        reference.x,
        reference.z,
        reference.species,
      ])
      expect(plant.y - reference.y).toBeCloseTo(0.8, 9)
    })
  })
})
