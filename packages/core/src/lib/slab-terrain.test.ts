import { describe, expect, test } from 'bun:test'
import {
  createSceneSpatialGrid,
  createTerrainField,
  encodeTerrainField,
  liftedManualSlab,
  slabTerrainHeightAt,
  useLiveTerrain,
} from '@pascal-app/core'
import { type AnyNode, BuildingNode, LevelNode, SiteNode, SlabNode } from '@pascal-app/core/schema'

function scene(transformed = false, offset = 0) {
  const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
  for (let z = 0; z < 9; z++) {
    for (let x = 0; x < 9; x++) field.heights[z * 9 + x] = 50 * x + 25 * z + 100 * offset
  }
  const site = SiteNode.parse({
    id: 'site_drape',
    children: ['building_drape'],
    terrain: encodeTerrainField(field),
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
    },
  })
  const building = BuildingNode.parse({
    id: 'building_drape',
    parentId: site.id,
    children: ['level_drape'],
    position: transformed ? [3, 2, 4] : [0, 0, 0],
    rotation: transformed ? [0, Math.PI / 2, 0] : [0, 0, 0],
  })
  const level = LevelNode.parse({
    id: 'level_drape',
    parentId: building.id,
    level: 0,
    height: 3,
    baseElevation: transformed ? 1 : 0,
    children: ['slab_drape'],
  })
  const slab = SlabNode.parse({
    id: 'slab_drape',
    parentId: level.id,
    polygon: [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ],
    elevation: 0.1,
    thickness: 0.05,
    terrainMode: 'draped',
    autoFromWalls: false,
    metadata: { flatwork: 'walk' },
  })
  return {
    slab,
    nodes: Object.fromEntries(
      [site, building, level, slab].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>,
  }
}

// Analytical plane y=.5x+.25z: the slab samples terrain in Site coordinates,
// then expresses the top in its own level frame with the authored clearance.
describe('draped slab support height', () => {
  for (const courtyard of [false, true]) {
    test(`a raised base does not add foundation lift to draped clearance (courtyard=${courtyard})`, () => {
      const { nodes, slab } = scene()
      const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
      const site = SiteNode.parse({ ...nodes.site_drape, terrain: encodeTerrainField(field) })
      const base = SlabNode.parse({
        id: 'slab_foundation',
        parentId: slab.parentId,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        holes: courtyard
          ? [
              [
                [0.5, 0.5],
                [3.5, 0.5],
                [3.5, 3.5],
                [0.5, 3.5],
              ],
            ]
          : [],
        plateRole: 'base',
        floorHeight: 1.05,
        referenceFloorElevation: 0.05,
        elevation: 1.05,
      })
      const path = SlabNode.parse({ ...slab, elevation: 0.03 })
      const raised = { ...nodes, [site.id]: site, [base.id]: base, [path.id]: path }
      const lifted = liftedManualSlab(raised, path)
      expect(lifted.elevation).toBeCloseTo(0.03, 8)
      expect(slabTerrainHeightAt(lifted, raised, 2, 2)).toBeCloseTo(0.03, 8)
      const flat = SlabNode.parse({ ...path, terrainMode: 'flat' })
      expect(liftedManualSlab({ ...raised, [flat.id]: flat }, flat).elevation).toBeCloseTo(1.03, 8)
      if (courtyard) {
        const support = createSceneSpatialGrid(raised).getSlabSupportForItem(
          'level_drape',
          [2, 0, 2],
          [0.2, 1, 0.2],
          [0, 0, 0],
        )
        expect(support.slabId).toBe(path.id)
        expect(support.elevation).toBeCloseTo(0.03, 8)
      }
    })
  }

  test('follows both horizontal terrain axes with the requested clearance', () => {
    const { slab, nodes } = scene()
    const before = structuredClone(nodes)
    for (const [x, z, height] of [
      [1, 1, 0.85],
      [2, 1, 1.35],
      [2, 3, 1.85],
    ] as const) {
      expect(slabTerrainHeightAt(slab, nodes, x, z)).toBeCloseTo(height, 8)
    }
    expect(nodes).toEqual(before)
  })

  test('rotated and translated buildings do not sample terrain in the wrong frame', () => {
    const { slab, nodes } = scene(true)
    // local(2,1) -> Site(4,2); Site top=2.5+.1, level origin Y=2+1.
    expect(slabTerrainHeightAt(slab, nodes, 2, 1)).toBeCloseTo(-0.4, 8)
    // local(1,3) -> Site(6,3); Site top=3.75+.1, same level origin.
    expect(slabTerrainHeightAt(slab, nodes, 1, 3)).toBeCloseTo(0.85, 8)
  })

  test('replacing Site terrain changes support without changing the authored slab', () => {
    const { slab, nodes } = scene()
    const saved = structuredClone(slab)
    expect(slabTerrainHeightAt(slab, nodes, 2, 1)).toBeCloseTo(1.35, 8)
    const raised = scene(false, 1).nodes.site_drape
    if (!raised) throw new Error('The raised Site fixture is missing')
    expect(slabTerrainHeightAt(slab, { ...nodes, [raised.id]: raised }, 2, 1)).toBeCloseTo(2.35, 8)
    expect(slab).toEqual(saved)
  })

  test('legacy and explicitly flat slabs keep the authored top even above shaped ground', () => {
    const { slab, nodes } = scene(true)
    for (const terrainMode of [undefined, 'flat'] as const) {
      const flat = SlabNode.parse({ ...slab, terrainMode, elevation: 0.7 })
      expect(slabTerrainHeightAt(flat, nodes, 2, 1)).toBe(0.7)
      expect(slabTerrainHeightAt(flat, nodes, 1, 3)).toBe(0.7)
    }
  })

  test('absent terrain is datum ground, not an unknown fabricated slope', () => {
    const { slab, nodes } = scene()
    const site = SiteNode.parse({ ...nodes.site_drape, terrain: undefined })
    expect(slabTerrainHeightAt(slab, { ...nodes, [site.id]: site }, 2, 1)).toBeCloseTo(0.1, 8)
  })

  test('persisted facts and headless support ignore an uncommitted live terrain stroke', () => {
    const { slab, nodes } = scene()
    const live = createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
    live.heights.fill(500)
    useLiveTerrain.getState().begin('site_drape', live)
    try {
      expect(slabTerrainHeightAt(slab, nodes, 2, 2)).toBeCloseTo(1.6, 8)
      expect(slabTerrainHeightAt(slab, nodes, 2, 2, 'live')).toBeCloseTo(5.1, 8)
      expect(createSceneSpatialGrid(nodes).getSlabElevationAt('level_drape', 2, 2)).toBeCloseTo(
        1.6,
        8,
      )
    } finally {
      useLiveTerrain.getState().end('site_drape')
    }
    expect(slabTerrainHeightAt(slab, nodes, 2, 2, 'live')).toBeCloseTo(1.6, 8)
  })

  test('support and downward pointer queries use the sampled top rather than the flat clearance', () => {
    const { nodes } = scene()
    const grid = createSceneSpatialGrid(nodes)
    expect(grid.getSlabElevationAt('level_drape', 2, 2)).toBeCloseTo(1.6, 8)
    const support = grid.getSlabSupportForItem('level_drape', [2, 0, 2], [0.2, 1, 0.2], [0, 0, 0])
    expect(support.slabId).toBe('slab_drape')
    expect(support.elevation).toBeCloseTo(1.6, 8)
    const pointed = grid.getPointedSupportSurface('level_drape', [2, 10, 2], [0, -1, 0])
    expect(pointed.slabId).toBe('slab_drape')
    expect(pointed.elevation).toBeCloseTo(1.6, 8)
    expect(pointed.point).toEqual([2, 2])
  })

  test('a draped support below the level origin keeps its negative local height', () => {
    const { nodes, slab } = scene(true)
    const grid = createSceneSpatialGrid(nodes)
    // local(2,1.5) -> Site(4.5,2): terrain 2.75 + .1 clearance - 3 origin.
    expect(grid.getSlabElevationAt('level_drape', 2, 1.5)).toBeCloseTo(-0.15, 8)
    const support = grid.getSlabSupportForItem('level_drape', [2, 0, 1.5], [0.2, 1, 0.2], [0, 0, 0])
    expect(support.slabId).toBe(slab.id)
    expect(support.elevation).toBeCloseTo(-0.15, 8)
    const flat = SlabNode.parse({ ...slab, terrainMode: 'flat', elevation: -0.15 })
    expect(
      createSceneSpatialGrid({ ...nodes, [slab.id]: flat }).getSlabElevationAt(
        'level_drape',
        2,
        1.5,
      ),
    ).toBe(0)
  })

  test('offset item footprints sample their common node anchor rather than each part centre', () => {
    const { nodes } = scene()
    const grid = createSceneSpatialGrid(nodes)
    for (const x of [1.75, 2.25]) {
      const support = grid.getSlabSupportForItem(
        'level_drape',
        [x, 0, 2],
        [0.2, 1, 0.2],
        [0, 0, 0],
        undefined,
        [2, 2],
      )
      expect(support.slabId).toBe('slab_drape')
      expect(support.elevation).toBeCloseTo(1.6, 8)
    }
  })

  test('support election observes changed terrain and an explicit return to flat mode', () => {
    const { nodes, slab } = scene()
    const raised = scene(false, 1).nodes.site_drape
    if (!raised) throw new Error('The raised Site fixture is missing')
    expect(
      createSceneSpatialGrid({ ...nodes, [raised.id]: raised }).getSlabElevationAt(
        'level_drape',
        2,
        2,
      ),
    ).toBeCloseTo(2.6, 8)
    expect(
      createSceneSpatialGrid({
        ...nodes,
        [slab.id]: { ...slab, terrainMode: 'flat' },
      }).getSlabElevationAt('level_drape', 2, 2),
    ).toBeCloseTo(0.1, 8)
  })

  test('a draped slab hole does not become item or pointer support', () => {
    const { nodes, slab } = scene()
    const perforated = SlabNode.parse({
      ...slab,
      holes: [
        [
          [1.5, 1.5],
          [2.5, 1.5],
          [2.5, 2.5],
          [1.5, 2.5],
        ],
      ],
    })
    const grid = createSceneSpatialGrid({ ...nodes, [slab.id]: perforated })
    expect(
      grid.getSlabSupportForItem('level_drape', [2, 0, 2], [0.1, 1, 0.1], [0, 0, 0]).slabId,
    ).not.toBe(slab.id)
    expect(grid.getPointedSupportSurface('level_drape', [2, 10, 2], [0, -1, 0]).slabId).not.toBe(
      slab.id,
    )
  })
})
