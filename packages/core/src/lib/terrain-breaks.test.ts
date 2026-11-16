import { describe, expect, test } from 'bun:test'
import {
  createSceneSpatialGrid,
  createTerrainField,
  encodeTerrainField,
  heightAt,
  isFlatOver,
  normalAt,
  persistedTerrainFieldOf,
  raycastTerrain,
  slabTerrainHeightAt,
  slopeAt,
  type TerrainField,
  terrainBreakFacts,
  terrainBreakHeightAt,
  terrainBreakSideAt,
  terrainBreaksOf,
  terrainContours,
  terrainPreviewField,
} from '@pascal-app/core'
import {
  AnyNode,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  TerrainBreakNode,
  TerrainTileNode,
} from '@pascal-app/core/schema'

const line: [number, number][] = [
  [4, 0],
  [4, 8],
]
const ring: [number, number][] = [
  [2, 2],
  [6, 2],
  [6, 6],
  [2, 6],
  [2, 2],
]

function terrainBreak(overrides: Record<string, unknown> = {}) {
  return TerrainBreakNode.parse({
    id: 'terrain-break_edge',
    parentId: 'site_breaks',
    line,
    kind: 'cliff',
    left: 5,
    right: 2,
    ...overrides,
  })
}

function scene(field: TerrainField, breaks: TerrainBreakNode[] = [terrainBreak()]) {
  const site = SiteNode.parse({
    id: 'site_breaks',
    children: breaks.map((edge) => edge.id),
    terrain: encodeTerrainField(field),
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [site, ...breaks].map((node) => [node.id, node]),
  )
  const authority = persistedTerrainFieldOf(site, nodes)
  if (!authority) throw new Error('Expected terrain authority')
  return { site, nodes, authority }
}

// Contract oracles: directed XZ cross product, constant planes and the 3-4-5
// triangle. Neither expected heights nor face areas are obtained from candidate geometry.
describe('terrain break persisted contract', () => {
  test('round-trips through the public node union and belongs only to its parent site', () => {
    const edge = terrainBreak()
    expect(AnyNode.parse(JSON.parse(JSON.stringify(edge)))).toEqual(edge)
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const { site, nodes } = scene(field)
    const other = terrainBreak({ id: 'terrain-break_other', parentId: 'site_other' })
    expect(terrainBreaksOf(site, { ...nodes, [other.id]: other }).map((node) => node.id)).toEqual([
      edge.id,
    ])
  })

  test('requires a numeric side and supported, nondegenerate line geometry', () => {
    for (const invalid of [
      { left: 'ground', right: 'ground' },
      { left: Number.NaN },
      { right: Number.POSITIVE_INFINITY },
      {
        line: [
          [0, 0],
          [0, 0],
        ],
      },
      {
        line: [
          [0, 0],
          [2, 1],
          [4, 0],
        ],
      },
      {
        line: [
          [0, 0],
          [4, 4],
          [0, 4],
          [4, 0],
          [0, 0],
        ],
      },
      {
        line: [
          [0, 0],
          [0, 4],
          [4, 4],
          [4, 0],
          [0, 0],
        ],
      },
    ])
      expect(TerrainBreakNode.safeParse({ ...terrainBreak(), ...invalid }).success).toBe(false)
    expect(
      TerrainBreakNode.safeParse({
        ...terrainBreak(),
        line: [
          [0, 0],
          [2, 2],
          [4, 4],
        ],
      }).success,
    ).toBe(true)
    expect(
      TerrainBreakNode.safeParse({ ...terrainBreak(), line: ring, kind: 'retaining' }).success,
    ).toBe(true)
  })

  test('positive cross is left, including the line, and a CCW ring has its inside on the left', () => {
    const edge = terrainBreak()
    expect(terrainBreakSideAt(edge, 4 - 1e-7, 3)).toBe('left')
    expect(terrainBreakSideAt(edge, 4, 3)).toBe('left')
    expect(terrainBreakSideAt(edge, 4 + 1e-7, 3)).toBe('right')
    const closed = terrainBreak({ line: ring })
    expect(terrainBreakSideAt(closed, 4, 4)).toBe('left')
    expect(terrainBreakSideAt(closed, 2, 4)).toBe('left')
    expect(terrainBreakSideAt(closed, 2 - 1e-7, 4)).toBe('right')
    expect(terrainBreakSideAt(closed, 7, 7)).toBe('right')
  })
})

describe('terrain break height authority', () => {
  test('flatness includes raised lattice posts on the exact rectangle boundary', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 0.5 })
    field.heights[1] = 100
    field.heights[field.cols + 1] = 100
    const edge = terrainBreak({
      line: [
        [3, 0],
        [3, 4],
      ],
      left: 'ground',
      right: 2,
    })
    const { authority } = scene(field, [edge])
    expect(heightAt(authority, 0.5, 0)).toBe(1)
    expect(heightAt(authority, 0.5, 0.5)).toBe(1)
    expect(isFlatOver(authority, 0, 0, 1, 0.5)).toBe(false)
  })

  test('flatness detects an enclosed sub-grid pad without rejecting a footprint wholly inside it', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 0.5 })
    const edge = terrainBreak({
      line: [
        [0.2, 0.2],
        [0.3, 0.2],
        [0.3, 0.3],
        [0.2, 0.3],
        [0.2, 0.2],
      ],
    })
    const { authority } = scene(field, [edge])
    expect(isFlatOver(authority, 0.21, 0.21, 0.29, 0.29)).toBe(true)
    expect(isFlatOver(authority, 0, 0, 0.5, 0.5)).toBe(false)
    expect(isFlatOver(authority, 0.25, 0.21, 0.4, 0.29)).toBe(false)
    expect(isFlatOver(authority, 0.4, 0.4, 0.49, 0.49)).toBe(true)
  })

  test('a draped slab wholly inside a sub-grid pad supports items at the exact terrace height', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 0.5 })
    const edge = terrainBreak({
      line: [
        [0.2, 0.2],
        [0.3, 0.2],
        [0.3, 0.3],
        [0.2, 0.3],
        [0.2, 0.2],
      ],
    })
    const base = scene(field, [edge])
    const building = BuildingNode.parse({
      id: 'building_breaks',
      parentId: base.site.id,
      children: ['level_breaks'],
    })
    const level = LevelNode.parse({
      id: 'level_breaks',
      parentId: building.id,
      level: 0,
      children: ['slab_breaks'],
    })
    const slab = SlabNode.parse({
      id: 'slab_breaks',
      parentId: level.id,
      terrainMode: 'draped',
      elevation: 0.1,
      polygon: [
        [0.21, 0.21],
        [0.29, 0.21],
        [0.29, 0.29],
        [0.21, 0.29],
      ],
    })
    const site = SiteNode.parse({ ...base.site, children: [edge.id, building.id] })
    const nodes = {
      ...base.nodes,
      [site.id]: site,
      [building.id]: building,
      [level.id]: level,
      [slab.id]: slab,
    }
    expect(slabTerrainHeightAt(slab, nodes, 0.25, 0.25)).toBeCloseTo(5.1, 6)
    const support = createSceneSpatialGrid(nodes).getSlabSupportForItem(
      level.id,
      [0.25, 0, 0.25],
      [0.02, 0.1, 0.02],
      [0, 0, 0],
    )
    expect(support.slabId).toBe(slab.id)
    expect(support.elevation).toBeCloseTo(5.1, 6)
  })

  for (const spacing of [0.5, 0.95]) {
    test(`numeric heights stay discontinuous to 1 mm on a ${spacing} m legacy grid`, () => {
      const field = createTerrainField({ cols: 20, rows: 20, spacing, origin: [0.13, 0.27] })
      field.heights.fill(1700)
      const { authority } = scene(field)
      for (const distance of [1e-7, 0.01, 0.25]) {
        expect(Math.abs(heightAt(authority, 4 - distance, 3.17) - 5)).toBeLessThanOrEqual(0.001)
        expect(Math.abs(heightAt(authority, 4 + distance, 3.17) - 2)).toBeLessThanOrEqual(0.001)
      }
      expect(heightAt(authority, 4, 3.17)).toBe(5)
    })

    test(`opposite-side sample contamination cannot alter keep-ground at ${spacing} m spacing`, () => {
      const field = createTerrainField({ cols: 20, rows: 20, spacing, origin: [0.13, 0.27] })
      field.heights.fill(125)
      const polluted = { ...field, heights: field.heights.slice() }
      for (let row = 0; row < field.rows; row++)
        for (let col = 0; col < field.cols; col++)
          if (field.origin[0] + col * spacing > 4) polluted.heights[row * field.cols + col] = 3000
      const edge = terrainBreak({ left: 'ground', right: -2 })
      const clean = scene(field, [edge]).authority
      const dirty = scene(polluted, [edge]).authority
      for (const x of [4 - 1e-7, 3.9, 3.5, 4]) {
        expect(Math.abs(heightAt(clean, x, 3.17) - 1.25)).toBeLessThanOrEqual(0.001)
        expect(heightAt(dirty, x, 3.17)).toBe(heightAt(clean, x, 3.17))
        expect(terrainBreakHeightAt(polluted, edge, 'left', x, 3.17)).toBe(1.25)
        expect(slopeAt(dirty, x, 3.17)).toBeCloseTo(0, 8)
        const [nx, ny, nz] = normalAt(dirty, x, 3.17)
        expect(nx).toBeCloseTo(0, 8)
        expect(ny).toBeCloseTo(1, 8)
        expect(nz).toBeCloseTo(0, 8)
      }
    })
  }

  test('normals and slopes use the selected side, not a finite difference across the drop', () => {
    const field = createTerrainField({ cols: 20, rows: 20, spacing: 0.5 })
    const { authority } = scene(field)
    for (const x of [4 - 1e-7, 4, 4 + 1e-7]) {
      expect(slopeAt(authority, x, 3.17)).toBeCloseTo(0, 8)
      const [nx, ny, nz] = normalAt(authority, x, 3.17)
      expect(nx).toBeCloseTo(0, 8)
      expect(ny).toBeCloseTo(1, 8)
      expect(nz).toBeCloseTo(0, 8)
    }
  })

  test('a bounded ground preview preserves numeric break sides and leaves distant ground unchanged', () => {
    const field = createTerrainField({ cols: 20, rows: 20, spacing: 0.5 })
    field.heights.fill(125)
    const { authority } = scene(field, [terrainBreak({ left: 5, right: 'ground' })])
    const preview = createTerrainField({ origin: [2, 2], cols: 9, rows: 9, spacing: 0.5 })
    preview.heights.fill(900)
    const live = terrainPreviewField(preview, authority)
    expect(heightAt(live, 4 - 1e-7, 3)).toBe(5)
    expect(heightAt(live, 4, 3)).toBe(5)
    expect(heightAt(live, 4 + 1e-7, 3)).toBe(9)
    expect(heightAt(live, 5, 3)).toBe(9)
    expect(heightAt(live, 7, 3)).toBe(1.25)
    expect(heightAt(authority, 5, 3)).toBe(1.25)
  })

  test('a preview is made once for an edit and a ground, however many readers ask', () => {
    const field = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
    field.heights.fill(125)
    const { authority } = scene(field, [terrainBreak({ left: 5, right: 'ground' })])
    const edit = createTerrainField({ origin: [2, 2], cols: 9, rows: 9, spacing: 0.5 })
    edit.heights.fill(900)
    const live = terrainPreviewField(edit, authority)
    // Every ground mesh, the skirt and each break read the stroke's preview on every dab.
    expect(terrainPreviewField(edit, authority)).toBe(live)
    // The next dab is another edit field, and another ground another preview.
    const next = { ...edit, heights: new Int16Array(edit.heights).fill(950) }
    const dabbed = terrainPreviewField(next, authority)
    expect(dabbed).not.toBe(live)
    expect(heightAt(dabbed, 5, 3)).toBe(9.5)
    expect(heightAt(live, 5, 3)).toBe(9)
    expect(terrainPreviewField(edit, null)).not.toBe(live)
    expect(terrainPreviewField(edit, null)).toBe(terrainPreviewField(edit, null))
  })

  test('ending a preview restores tile-only ground instead of sampling an empty virtual buffer', () => {
    const samples = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
    samples.heights.fill(200)
    const edge = terrainBreak({ right: 'ground' })
    const tile = TerrainTileNode.parse({
      id: 'terrain-tile_preview',
      parentId: 'site_breaks',
      ix: 0,
      iz: 0,
      heights: encodeTerrainField(samples).heights,
    })
    const site = SiteNode.parse({ id: 'site_breaks', children: [edge.id, tile.id] })
    const authority = persistedTerrainFieldOf(site, {
      [site.id]: site,
      [tile.id]: tile,
      [edge.id]: edge,
    })
    if (!authority) throw new Error('Expected tile-only terrain authority')
    const restored = terrainPreviewField(authority, authority)
    expect(heightAt(restored, 3, 3)).toBe(5)
    expect(heightAt(restored, 5, 3)).toBe(2)
    expect(heightAt(restored, 4 + 1e-7, 3)).toBe(2)
    expect(heightAt(authority, 5, 3)).toBe(2)
  })

  test('a distant break preserves the nonplanar source continuation on its keep-ground side', () => {
    const field = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++)
        field.heights[row * field.cols + col] = 200 + row * row + col * col
    const original = scene(field, []).authority
    const edge = terrainBreak({
      line: [
        [-16, 40],
        [48, 40],
      ],
      left: 5,
      right: 'ground',
    })
    const withBreak = scene(field, [edge]).authority
    // The complete curved source occupies [0,32]², strictly below the break.
    // Its existing continuation is the oracle; adding a feature on the other
    // side must not replace that continuation with one triangle's tangent plane.
    for (const x of [0.25, 12.25, 31.75])
      for (const z of [32.1, 34, 39.5, 40 - 1e-7])
        expect(Math.abs(heightAt(withBreak, x, z) - heightAt(original, x, z))).toBeLessThanOrEqual(
          0.001,
        )
    expect(heightAt(withBreak, 12.25, 40)).toBe(5)
    expect(heightAt(withBreak, 12.25, 40 + 1e-7)).toBe(5)
  })

  test('a nested terrace overrides the upper cliff region and keeps composed ground independent of IDs', () => {
    const field = createTerrainField({ cols: 20, rows: 20, spacing: 0.5 })
    field.heights.fill(125)
    for (const [openId, closedId] of [
      ['z', 'a'],
      ['a', 'z'],
    ] as const) {
      const cliff = terrainBreak({ id: `terrain-break_${openId}` })
      const terrace = terrainBreak({
        id: `terrain-break_${closedId}`,
        line: [
          [1, 2],
          [3, 2],
          [3, 6],
          [1, 6],
          [1, 2],
        ],
        kind: 'retaining',
        left: 7,
        right: 'ground',
      })
      for (const edges of [
        [cliff, terrace],
        [terrace, cliff],
      ]) {
        const { authority } = scene(field, edges)
        expect(heightAt(authority, 2, 4)).toBe(7)
        expect(heightAt(authority, 3 - 1e-7, 4)).toBe(7)
        expect(heightAt(authority, 3 + 1e-7, 4)).toBe(5)
        expect(heightAt(authority, 4 - 1e-7, 4)).toBe(5)
        expect(heightAt(authority, 4 + 1e-7, 4)).toBe(2)
        expect(terrainBreakFacts(terrace, authority)).toMatchObject({
          lengthM: 12,
          left: { minM: 7, maxM: 7 },
          right: { minM: 5, maxM: 5 },
          dropMinM: 2,
          dropMaxM: 2,
          faceAreaM2: 24,
        })
      }
    }
  })

  test('an old no-break scene keeps its sampled field and serialized bytes unchanged', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 0.95, origin: [0.13, 0.27] })
    for (let i = 0; i < field.heights.length; i++) field.heights[i] = ((i * 37) % 211) - 100
    const { site, nodes, authority } = scene(field, [])
    const frozen = JSON.stringify(nodes)
    expect(terrainBreaksOf(site, nodes)).toEqual([])
    for (const [x, z] of [
      [0.13, 0.27],
      [2.31, 4.71],
      [5.95, 2.77],
    ] as const) {
      expect(heightAt(authority, x, z)).toBe(heightAt(field, x, z))
    }
    // B1's virtual authority uses 0.5 m derivative probes, not the native grid
    // spacing. Interior probes avoid conflating continuation with dense clamping.
    const reference: TerrainField = {
      ...field,
      spacing: 0.5,
      readHeightAt: (x, z) => heightAt(field, x, z),
    }
    for (const [x, z] of [
      [2.31, 4.71],
      [5.95, 2.77],
    ] as const) {
      expect(normalAt(authority, x, z)).toEqual(normalAt(reference, x, z))
      expect(slopeAt(authority, x, z)).toBe(slopeAt(reference, x, z))
    }
    // The composed query authority is virtual; persistence belongs to Site.
    expect(site.terrain).toEqual(encodeTerrainField(field))
    expect(JSON.stringify(nodes)).toBe(frozen)
  })
})

describe('terrain break measurable facts', () => {
  test('measures a varying ground side instead of replacing its range by a midpoint sample', () => {
    const field = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++) field.heights[row * field.cols + col] = row * 50
    // Ground is y=z. Along the 8 m edge, drop is 10-z, hence integral 48 m².
    const edge = terrainBreak({ left: 10, right: 'ground' })
    const facts = terrainBreakFacts(edge, field)
    expect(facts.lengthM).toBe(8)
    expect(facts.left).toEqual({ minM: 10, maxM: 10 })
    expect(facts.right.minM).toBeCloseTo(0, 6)
    expect(facts.right.maxM).toBeCloseTo(8, 6)
    expect(facts.dropMinM).toBeCloseTo(2, 6)
    expect(facts.dropMaxM).toBeCloseTo(10, 6)
    expect(facts.faceAreaM2).toBeCloseTo(48, 6)
    // Ground crosses the other side at the sampled midpoint z=4. Absolute
    // exposed area is two 4×4 right triangles, not a cancelling signed integral.
    const crossing = terrainBreakFacts(terrainBreak({ left: 4, right: 'ground' }), field)
    expect(crossing.dropMinM).toBeCloseTo(0, 6)
    expect(crossing.dropMaxM).toBeCloseTo(4, 6)
    expect(crossing.faceAreaM2).toBeCloseTo(16, 6)
  })

  test('reports exact length, side ranges, drop magnitude and face area in either direction', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    for (const [left, right] of [
      [5, 2],
      [2, 5],
    ] as const) {
      const edge = terrainBreak({
        line: [
          [1, 0],
          [4, 4],
        ],
        left,
        right,
      })
      expect(terrainBreakFacts(edge, field)).toMatchObject({
        lengthM: 5,
        left: { minM: left, maxM: left },
        right: { minM: right, maxM: right },
        dropMinM: 3,
        dropMaxM: 3,
        faceAreaM2: 15,
      })
    }
  })

  test('a closed retaining edge measures the whole perimeter, not its closing chord', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    field.heights.fill(100)
    const edge = terrainBreak({ line: ring, kind: 'retaining', left: 4, right: 'ground' })
    expect(terrainBreakFacts(edge, field)).toMatchObject({
      lengthM: 16,
      left: { minM: 4, maxM: 4 },
      right: { minM: 1, maxM: 1 },
      dropMinM: 3,
      dropMaxM: 3,
      faceAreaM2: 48,
    })
  })
})

describe('terrain break ray intersections', () => {
  test('vertical rays immediately beside a break hit the authored side, not an interpolated ramp', () => {
    const field = createTerrainField({ cols: 20, rows: 20, spacing: 0.95 })
    const { authority } = scene(field)
    for (const [x, y] of [
      [4 - 1e-7, 5],
      [4, 5],
      [4 + 1e-7, 2],
    ] as const) {
      const hit = raycastTerrain(authority, [x, 10, 3], [0, -1, 0])
      expect(hit).not.toBeNull()
      expect(hit?.x).toBeCloseTo(x, 8)
      expect(hit?.z).toBeCloseTo(3, 8)
      expect(hit?.y).toBeCloseTo(y, 3)
      expect(hit?.t).toBeCloseTo(10 - y, 3)
    }
  })

  test('a horizontal ray hits the vertical face at its own height, with unnormalized ray parameter', () => {
    const field = createTerrainField({ cols: 20, rows: 20, spacing: 0.95 })
    const { authority } = scene(field)
    const hit = raycastTerrain(authority, [6, 3.5, 3], [-2, 0, 0])
    expect(hit).not.toBeNull()
    expect(hit?.x).toBeCloseTo(4, 6)
    expect(hit?.y).toBeCloseTo(3.5, 6)
    expect(hit?.z).toBeCloseTo(3, 6)
    expect(hit?.t).toBeCloseTo(1, 6)
  })

  test('a sub-grid closed terrace cannot be skipped by horizontal or oblique ray marching', () => {
    const field = createTerrainField({ cols: 20, rows: 20, spacing: 0.95 })
    const edge = terrainBreak({
      kind: 'retaining',
      line: [
        [4.13, 2],
        [4.17, 2],
        [4.17, 6],
        [4.13, 6],
        [4.13, 2],
      ],
    })
    const { authority } = scene(field, [edge])
    const horizontal = raycastTerrain(authority, [3, 3, 4], [2, 0, 0])
    expect(horizontal).not.toBeNull()
    expect(horizontal?.x).toBeCloseTo(4.13, 6)
    expect(horizontal?.y).toBeCloseTo(3, 6)
    expect(horizontal?.z).toBeCloseTo(4, 6)
    expect(horizontal?.t).toBeCloseTo(0.565, 6)
    const oblique = raycastTerrain(authority, [3, 4, 3], [1, -0.25, 0.5])
    expect(oblique).not.toBeNull()
    expect(oblique?.x).toBeCloseTo(4.13, 6)
    expect(oblique?.y).toBeCloseTo(3.7175, 6)
    expect(oblique?.z).toBeCloseTo(3.565, 6)
    expect(oblique?.t).toBeCloseTo(1.13, 6)
    // The nearest surface still wins if the ray meets the top before a face.
    const top = raycastTerrain(authority, [4.15, 10, 3], [0, -1, 0])
    expect(top?.y).toBeCloseTo(5, 3)
    expect(top?.t).toBeCloseTo(5, 3)
  })
})

describe('terrain break contour sampling', () => {
  test('a raised ring contained in one contour cell cannot be crossed by the lower ground contour', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 0.5 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++) field.heights[row * field.cols + col] = col * 50
    const edge = terrainBreak({
      line: [
        [0.2, 0.2],
        [0.3, 0.2],
        [0.3, 0.3],
        [0.2, 0.3],
        [0.2, 0.2],
      ],
      right: 'ground',
    })
    const { authority } = scene(field, [edge])
    const contours = terrainContours(authority, 0.25, [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]).filter((contour) => contour.levelM === 0.25)
    expect(contours.length).toBeGreaterThan(0)
    expect(contours.some((contour) => contour.points.some((point) => point[1] >= 1.5))).toBe(true)
    for (const contour of contours) {
      for (const [x] of contour.points) expect(x).toBeCloseTo(0.25, 6)
      for (let i = 1; i < contour.points.length; i++) {
        const a = contour.points[i - 1]
        const b = contour.points[i]
        if (!a || !b) throw new Error('Expected consecutive contour points')
        const minZ = Math.min(a[1], b[1])
        const maxZ = Math.max(a[1], b[1])
        expect(maxZ <= 0.2 || minZ >= 0.3).toBe(true)
      }
    }
  })

  test('two flat sides do not invent intermediate sloping contours across a vertical face', () => {
    const field = createTerrainField({ cols: 20, rows: 20, spacing: 0.95 })
    const { authority } = scene(field)
    const contours = terrainContours(authority, 1, [
      [0, 0],
      [8, 0],
      [8, 8],
      [0, 8],
    ])
    // Neither open horizontal surface contains elevation 3 or 4. The vertical
    // face is reported as a break, never as a marching-squares ramp contour.
    expect(contours.filter((contour) => contour.levelM > 2 && contour.levelM < 5)).toEqual([])
  })
})
