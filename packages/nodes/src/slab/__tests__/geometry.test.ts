import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  getRenderableSlabPolygon,
  LevelNode,
  SiteNode,
  SlabNode,
  slabPolygonContextFromGeometry,
  WallNode,
} from '@pascal-app/core'
import { type Group, Mesh } from 'three'
import { buildSlabGeometry } from '../geometry'

function meshesOf(group: Group): Mesh[] {
  return group.children.filter((child): child is Mesh => child instanceof Mesh)
}

function triangleCount(mesh: Mesh): number {
  const index = mesh.geometry.getIndex()
  return (index ? index.count : mesh.geometry.getAttribute('position').count) / 3
}

function disposeGroup(group: Group) {
  group.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose()
  })
}

// A threshold strip spans a wall between two rectangular floors. Both long edges
// seam onto the wall centerline, so its renderable polygon collapses to a line.
const THRESHOLD_STRIP: Array<[number, number]> = [
  [1.9, 1],
  [2.1, 1],
  [2.1, 2],
  [1.9, 2],
]

function collapsedStripContext(strip: SlabNode): GeometryContext {
  const wall = WallNode.parse({
    id: 'wall_threshold',
    parentId: 'level_threshold',
    start: [2, 0],
    end: [2, 4],
    thickness: 0.2,
    height: 3,
  })
  const left = SlabNode.parse({
    id: 'slab_left',
    parentId: 'level_threshold',
    elevation: 0.01,
    thickness: 0.01,
    autoFromWalls: false,
    polygon: [
      [0, 0],
      [1.9, 0],
      [1.9, 4],
      [0, 4],
    ],
  })
  const right = SlabNode.parse({
    id: 'slab_right',
    parentId: 'level_threshold',
    elevation: 0.01,
    thickness: 0.01,
    autoFromWalls: false,
    polygon: [
      [2.1, 0],
      [4, 0],
      [4, 4],
      [2.1, 4],
    ],
  })
  const level = LevelNode.parse({
    id: 'level_threshold',
    level: 0,
    children: [wall.id, left.id, right.id, strip.id],
  })
  const nodes: Record<string, AnyNode> = {
    [level.id]: level,
    [wall.id]: wall,
    [left.id]: left,
    [right.id]: right,
    [strip.id]: strip,
  }
  return {
    resolve: (id) => nodes[id] as never,
    children: [],
    siblings: [left, right],
    parent: level,
  }
}

function thresholdStrip(): SlabNode {
  return SlabNode.parse({
    id: 'slab_threshold',
    parentId: 'level_threshold',
    elevation: 0.01,
    thickness: 0.01,
    autoFromWalls: false,
    polygon: THRESHOLD_STRIP,
  })
}

function geometryContext(site: ReturnType<typeof SiteNode.parse>): GeometryContext {
  const building = BuildingNode.parse({
    id: 'building_test',
    parentId: site.id,
    children: ['level_test'],
  })
  const level = LevelNode.parse({
    id: 'level_test',
    parentId: building.id,
    level: 0,
    height: 2.5,
    children: [],
  })
  const nodes = { [site.id]: site, [building.id]: building, [level.id]: level }
  return {
    resolve: (id) => nodes[id as keyof typeof nodes],
    children: [],
    siblings: [],
    parent: level,
  }
}

describe('buildSlabGeometry', () => {
  test('copies the primary UVs into uv2 for every slab mesh', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })

    const group = buildSlabGeometry(slab, undefined, 'solid', false)
    const meshes = group.children.filter((child): child is Mesh => child instanceof Mesh)

    expect(meshes).toHaveLength(2)
    for (const mesh of meshes) {
      const uv = mesh.geometry.getAttribute('uv')
      const uv2 = mesh.geometry.getAttribute('uv2')

      expect(uv2).toBeDefined()
      expect(uv2.itemSize).toBe(2)
      expect(uv2.count).toBe(uv.count)
      expect(Array.from(uv2.array)).toEqual(Array.from(uv.array))
    }
  })

  test('solid slab meshes stay at the level plane; recessed meshes sink to the elevation', () => {
    const polygon: Array<[number, number]> = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]

    const solid = SlabNode.parse({ elevation: 0.3, thickness: 0.1, polygon })
    const solidGroup = buildSlabGeometry(solid, undefined, 'solid', false)
    for (const mesh of solidGroup.children.filter(
      (child): child is Mesh => child instanceof Mesh,
    )) {
      expect(mesh.position.y).toBe(0)
    }

    const recessed = SlabNode.parse({
      elevation: 0.45,
      recessed: true,
      recessedRimElevation: 0.6,
      polygon,
    })
    const recessedGroup = buildSlabGeometry(recessed, undefined, 'solid', false)
    const recessedMeshes = recessedGroup.children.filter(
      (child): child is Mesh => child instanceof Mesh,
    )
    expect(recessedMeshes.length).toBeGreaterThan(0)
    let localTop = Number.NEGATIVE_INFINITY
    for (const mesh of recessedMeshes) {
      expect(mesh.position.y).toBeCloseTo(0.45)
      mesh.geometry.computeBoundingBox()
      localTop = Math.max(localTop, mesh.geometry.boundingBox?.max.y ?? Number.NEGATIVE_INFINITY)
    }
    expect(localTop).toBeCloseTo(0.15)
  })

  test('adds a terrain-following perimeter below the fixed slab underside', () => {
    const site = SiteNode.parse({
      id: 'site_test',
      children: ['building_test'],
      terrain: encodeTerrainField(
        createTerrainField({ cols: 5, rows: 5, spacing: 1, origin: [-1, -1] }),
      ),
    })
    const slab = SlabNode.parse({
      elevation: 0.8,
      thickness: 0.2,
      fillToTerrain: true,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })

    const group = buildSlabGeometry(slab, geometryContext(site), 'solid', false)
    const meshes = group.children.filter((child): child is Mesh => child instanceof Mesh)
    expect(meshes).toHaveLength(3)

    const fill = meshes[2]!
    fill.geometry.computeBoundingBox()
    expect(fill.userData.slotId).toBe('side')
    expect(fill.geometry.boundingBox?.min.y).toBeCloseTo(0)
    expect(fill.geometry.boundingBox?.max.y).toBeCloseTo(0.6)
  })

  test('follows the flat datum before the site has a persisted terrain field', () => {
    const site = SiteNode.parse({ id: 'site_test', children: ['building_test'] })
    const slab = SlabNode.parse({
      elevation: 0.4,
      thickness: 0.1,
      fillToTerrain: true,
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    })

    const group = buildSlabGeometry(slab, geometryContext(site), 'solid', false)
    const fill = group.children.filter((child): child is Mesh => child instanceof Mesh)[2]!
    fill.geometry.computeBoundingBox()
    expect(fill.geometry.boundingBox?.min.y).toBeCloseTo(0)
    expect(fill.geometry.boundingBox?.max.y).toBeCloseTo(0.3)
  })
})

describe('buildSlabGeometry on empty and collapsed polygons', () => {
  test('an empty polygon builds an empty group', () => {
    for (const recessed of [false, true]) {
      const slab = SlabNode.parse({ polygon: [], recessed, recessedRimElevation: 0.3 })
      const group = buildSlabGeometry(slab, undefined, 'solid', false)
      expect(meshesOf(group)).toHaveLength(0)
    }
  })

  test('a polygon with fewer than three points builds an empty group', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [2, 0],
      ],
    })
    expect(meshesOf(buildSlabGeometry(slab, undefined, 'solid', false))).toHaveLength(0)
  })

  test('a zero-area polygon builds an empty group', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [1, 0],
        [2, 0],
        [1, 0],
      ],
    })
    expect(meshesOf(buildSlabGeometry(slab, undefined, 'solid', false))).toHaveLength(0)
  })

  test('a threshold strip collapses against its wall and builds empty', () => {
    const strip = thresholdStrip()
    const ctx = collapsedStripContext(strip)
    // The stored strip is valid, but wall seaming collapses its renderable polygon.
    expect(strip.polygon).toHaveLength(4)
    expect(
      getRenderableSlabPolygon(strip, slabPolygonContextFromGeometry(ctx)).length,
    ).toBeLessThan(3)

    const group = buildSlabGeometry(strip, ctx, 'rendered', true)
    expect(meshesOf(group)).toHaveLength(0)
  })

  test('a hole covering the whole slab builds an empty group', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      holes: [
        [
          [-1, -1],
          [3, -1],
          [3, 3],
          [-1, 3],
        ],
      ],
    })
    expect(meshesOf(buildSlabGeometry(slab, undefined, 'solid', false))).toHaveLength(0)
  })

  test('a slab with an interior hole still builds a top and a side mesh', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ],
    })
    const meshes = meshesOf(buildSlabGeometry(slab, undefined, 'solid', false))
    expect(meshes.map((mesh) => mesh.userData.slotId)).toEqual(['surface', 'side'])
    for (const mesh of meshes) expect(triangleCount(mesh)).toBeGreaterThan(0)
  })

  test('rebuilding across collapse and recovery never throws and disposes cleanly', () => {
    const strip = thresholdStrip()
    const ctx = collapsedStripContext(strip)
    const widened = SlabNode.parse({
      ...strip,
      polygon: [
        [1.5, 1],
        [2.5, 1],
        [2.5, 2],
        [1.5, 2],
      ],
    })
    const counts: number[] = []
    for (let pass = 0; pass < 3; pass += 1) {
      for (const node of [strip, widened, strip]) {
        const group = buildSlabGeometry(node, ctx, 'rendered', true)
        counts.push(meshesOf(group).length)
        disposeGroup(group)
      }
    }
    expect(counts).toEqual([0, 2, 0, 0, 2, 0, 0, 2, 0])
  })
})
