import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  planTerrainTileWrites,
  terrainEditField,
  terrainFieldOf,
  tileFieldOf,
} from '@pascal-app/core'
import { type AnyNode, SiteNode, TerrainTileNode, WallNode } from '@pascal-app/core/schema'

function tile(ix: number, iz: number, metres: number) {
  const field = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
  field.heights.fill(Math.round(metres / field.step))
  return TerrainTileNode.parse({
    id: `terrain-tile_${ix}_${iz}`,
    parentId: 'site_tiles',
    level: 0,
    ix,
    iz,
    step: field.step,
    heights: encodeTerrainField(field).heights,
  })
}

// B1's persisted contract: no conversion on load; the tile lattice is independent
// of an imported legacy grid. Expected heights are fixture values, not tile outputs.
describe('terrain tile persistence', () => {
  test('round-trips one 65² Int16 tile at a signed 32 m lattice coordinate', () => {
    const authored = tile(-2, 3, 1.23)
    const restored = TerrainTileNode.parse(JSON.parse(JSON.stringify(authored)))
    expect(restored).toEqual(authored)
    const field = tileFieldOf(restored)
    if (!field) throw new Error('Valid tile did not decode')
    expect(field).toMatchObject({ origin: [-64, 96], cols: 65, rows: 65, spacing: 0.5 })
    expect(heightAt(field, -48, 112)).toBe(1.23)
  })

  test('rejects unsupported levels, fractional indices, invalid steps and wrong sample payloads', () => {
    const valid = tile(0, 0, 0)
    const short = createTerrainField({ cols: 33, rows: 33, spacing: 0.5 })
    for (const invalid of [
      { level: 1 },
      { level: -1 },
      { ix: 0.5 },
      { iz: Number.NaN },
      { step: 0 },
      { step: -0.01 },
      { step: Number.POSITIVE_INFINITY },
      { heights: encodeTerrainField(short).heights },
      { heights: 'not base64' },
    ])
      expect(TerrainTileNode.safeParse({ ...valid, ...invalid }).success).toBe(false)
  })

  test('old scenes with and without a legacy field still load without creating tile data', () => {
    const plain = SiteNode.parse({ id: 'site_tiles' })
    expect(plain.terrain).toBeUndefined()
    expect(terrainFieldOf(plain, { [plain.id]: plain })).toBeNull()
    const legacy = createTerrainField({ cols: 5, rows: 5, origin: [-1.3, -0.7], spacing: 0.8 })
    legacy.heights.set([0, 11, -5, 39, 100])
    const encoded = encodeTerrainField(legacy)
    const site = SiteNode.parse(JSON.parse(JSON.stringify({ ...plain, terrain: encoded })))
    expect(site.terrain).toEqual(encoded)
    expect(site.children).toEqual(plain.children)
  })
})

describe('legacy terrain tile seeding', () => {
  function legacySite(crease = false) {
    const field = createTerrainField({
      cols: 69,
      rows: 69,
      spacing: 0.95,
      origin: crease ? [0.15, 0.2] : [0.13, 0.27],
    })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++)
        field.heights[row * field.cols + col] = crease
          ? Math.abs(col - 1) * 95
          : 113 + 19 * col + 38 * row
    return SiteNode.parse({ id: 'site_tiles', terrain: encodeTerrainField(field) })
  }

  test('an off-lattice plane seeds only the edited tile, within centimetre quantization', () => {
    // The stored integers describe y = .996 + .2x + .4z exactly.
    const site = legacySite()
    const nodes: Record<string, AnyNode> = { [site.id]: site }
    const frozen = JSON.stringify(nodes)
    const authority = persistedTerrainFieldOf(site, nodes)
    if (!authority) throw new Error('Missing legacy terrain')
    const before = terrainEditField(site, nodes, { minX: 4, minZ: 4, maxX: 40, maxZ: 40 })
    const heights = before.heights.slice()
    heights[8 * before.cols + 8] = 1234 // (8,8), well inside tile (0,0).
    const writes = planTerrainTileWrites(site, nodes, before, { ...before, heights })
    expect(writes.updates).toEqual([])
    expect(writes.creates).toHaveLength(1)
    const created = writes.creates[0]
    if (!created) throw new Error('The edit must create a tile')
    expect(created).toMatchObject({ parentId: site.id, ix: 0, iz: 0 })
    const after = persistedTerrainFieldOf(site, { ...nodes, [created.id]: created })
    if (!after) throw new Error('Missing edited terrain')
    expect(heightAt(after, 8, 8)).toBe(12.34)
    for (const [x, z] of [
      [2.13, 3.27],
      [16.25, 12.75],
      [30.4, 30.1],
    ] as const) {
      const expected = 0.996 + 0.2 * x + 0.4 * z
      expect(heightAt(authority, x, z)).toBeCloseTo(expected, 10)
      expect(Math.abs(heightAt(after, x, z) - heightAt(authority, x, z))).toBeLessThanOrEqual(0.01)
      // The half-metre samples round this particular plane upward by 4 mm.
      expect(heightAt(after, x, z) - expected).toBeCloseTo(0.004, 10)
    }
    for (const [x, z] of [
      [32.01, 12.27],
      [48.13, 48.27],
      [60, 12],
    ] as const)
      expect(heightAt(after, x, z)).toBe(heightAt(authority, x, z))
    expect(JSON.stringify(nodes)).toBe(frozen)
  })

  test('an unchanged edit window creates no tiles on an arbitrary legacy grid', () => {
    const site = legacySite()
    const nodes = { [site.id]: site }
    const frozen = JSON.stringify(nodes)
    const before = terrainEditField(site, nodes, { minX: 4, minZ: 4, maxX: 40, maxZ: 40 })
    expect(
      planTerrainTileWrites(site, nodes, before, { ...before, heights: before.heights.slice() }),
    ).toEqual({ creates: [], updates: [] })
    expect(JSON.stringify(nodes)).toBe(frozen)
  })

  test('editing an existing overlay seeds from its current heights, not the frozen legacy', () => {
    const site = legacySite()
    const existing = tile(0, 0, 7)
    const distant = tile(2, 0, 9)
    const nodes = { [site.id]: site, [existing.id]: existing, [distant.id]: distant }
    const frozen = JSON.stringify(nodes)
    const before = terrainEditField(site, nodes, { minX: 8, minZ: 8, maxX: 9, maxZ: 9 })
    const heights = before.heights.slice()
    heights[0] = 825
    const writes = planTerrainTileWrites(site, nodes, before, { ...before, heights })
    expect(writes.creates).toEqual([])
    expect(writes.updates).toHaveLength(1)
    const update = writes.updates.find((entry) => entry.id === existing.id)
    if (!update) throw new Error('The edited overlay must be updated in place')
    const updated = TerrainTileNode.parse({ ...existing, ...update })
    const after = persistedTerrainFieldOf(site, { ...nodes, [updated.id]: updated })
    if (!after) throw new Error('Missing updated terrain')
    expect(heightAt(after, 8, 8)).toBe(8.25)
    expect(heightAt(after, 16.25, 12.75)).toBe(7)
    expect(heightAt(after, 80, 16)).toBe(9)
    expect(JSON.stringify(nodes)).toBe(frozen)
  })

  test('a legacy crease can move untouched interior reads by more than quantization', () => {
    // y = |x - 1.1| has a legacy vertex at the crease. The new lattice's
    // x=1 and x=1.5 heights are .1 and .4: at x=1.1 their chord is .16 m.
    const site = legacySite(true)
    const nodes = { [site.id]: site }
    const frozen = JSON.stringify(nodes)
    const authority = persistedTerrainFieldOf(site, nodes)
    if (!authority) throw new Error('Missing legacy crease')
    const before = terrainEditField(site, nodes, { minX: 8, minZ: 8, maxX: 9, maxZ: 9 })
    const heights = before.heights.slice()
    heights[0] = 200
    const writes = planTerrainTileWrites(site, nodes, before, { ...before, heights })
    expect(writes.creates).toHaveLength(1)
    expect(writes.updates).toEqual([])
    const created = writes.creates[0]
    if (!created) throw new Error('The edit must create a tile')
    expect(created).toMatchObject({ ix: 0, iz: 0 })
    const after = persistedTerrainFieldOf(site, { ...nodes, [created.id]: created })
    if (!after) throw new Error('Missing seeded crease')
    expect(heightAt(after, 8, 8)).toBe(2)
    expect(heightAt(authority, 1.1, 2)).toBeCloseTo(0, 10)
    expect(heightAt(after, 1.1, 2)).toBeCloseTo(0.16, 10)
    expect(heightAt(after, 1.1, 2) - heightAt(authority, 1.1, 2)).toBeGreaterThan(0.01)
    // The same crease outside the seeded tile remains exactly authoritative.
    expect(heightAt(after, 1.1, 40)).toBe(heightAt(authority, 1.1, 40))
    expect(JSON.stringify(nodes)).toBe(frozen)
  })
})

describe('virtual terrain authority', () => {
  test('unrelated scene edits reuse terrain identity while a replaced tile invalidates it', () => {
    const site = SiteNode.parse({ id: 'site_tiles' })
    const authored = tile(0, 0, 2)
    const wall = WallNode.parse({
      id: 'wall_unrelated',
      start: [0, 0],
      end: [4, 0],
      height: 3,
    })
    const nodes: Record<string, AnyNode> = {
      [site.id]: site,
      [authored.id]: authored,
      [wall.id]: wall,
    }
    const original = persistedTerrainFieldOf(site, nodes)
    if (!original) throw new Error('Missing tiled terrain')
    const wallEdit = {
      ...nodes,
      [wall.id]: WallNode.parse({ ...wall, height: 4 }),
    }
    // E-010: unrelated construction edits must not invalidate every terrain mesh.
    expect(persistedTerrainFieldOf(site, wallEdit)).toBe(original)
    expect(terrainFieldOf(site, nodes)).toBe(original)
    expect(terrainFieldOf(site, wallEdit)).toBe(original)
    const changedTile = TerrainTileNode.parse({ ...authored, heights: tile(0, 0, 3).heights })
    const terrainEdit = { ...wallEdit, [authored.id]: changedTile }
    const changed = persistedTerrainFieldOf(site, terrainEdit)
    if (!changed) throw new Error('Updated tile lost terrain')
    expect(changed).not.toBe(original)
    expect(terrainFieldOf(site, terrainEdit)).toBe(changed)
    expect(heightAt(changed, 16, 16)).toBe(3)
    expect(heightAt(original, 16, 16)).toBe(2)
  })

  test('legacy samples and interpolated interior heights remain exactly equal on an unaligned grid', () => {
    const legacy = createTerrainField({ cols: 5, rows: 5, origin: [-1.3, -0.7], spacing: 0.8 })
    for (let i = 0; i < legacy.heights.length; i++) legacy.heights[i] = ((i * 137) % 503) - 251
    const site = SiteNode.parse({ id: 'site_tiles', terrain: encodeTerrainField(legacy) })
    const distant = tile(2, -1, 7)
    const nodes: Record<string, AnyNode> = { [site.id]: site, [distant.id]: distant }
    const virtual = persistedTerrainFieldOf(site, nodes)
    if (!virtual) throw new Error('Missing virtual field')
    const frozen = JSON.stringify(site.terrain)
    for (let row = 0; row <= 16; row++) {
      for (let col = 0; col <= 16; col++) {
        const x = legacy.origin[0] + col * 0.2
        const z = legacy.origin[1] + row * 0.2
        // The pre-existing legacy sampler is the independent reference for E-003.
        expect(heightAt(virtual, x, z)).toBe(heightAt(legacy, x, z))
      }
    }
    expect(JSON.stringify(site.terrain)).toBe(frozen)
    expect(virtual.origin[0]).toBeLessThanOrEqual(-1.3)
    expect(virtual.origin[1]).toBeLessThanOrEqual(-32)
    expect(virtual.origin[0] + (virtual.cols - 1) * virtual.spacing).toBeGreaterThanOrEqual(96)
    expect(virtual.origin[1] + (virtual.rows - 1) * virtual.spacing).toBeGreaterThanOrEqual(2.5)
  })

  test('a tile overrides the base, uncovered base stays authoritative, far context reaches the plane', () => {
    const legacy = createTerrainField({ cols: 129, rows: 65, spacing: 0.5 })
    legacy.heights.fill(200)
    const authored = tile(0, 0, 5)
    const unrelated = TerrainTileNode.parse({
      ...tile(0, 0, 9),
      id: 'terrain-tile_other',
      parentId: 'site_other',
    })
    const site = SiteNode.parse({ id: 'site_tiles', terrain: encodeTerrainField(legacy) })
    const field = persistedTerrainFieldOf(site, {
      [site.id]: site,
      [authored.id]: authored,
      [unrelated.id]: unrelated,
    })
    if (!field) throw new Error('Missing virtual field')
    expect(heightAt(field, 16, 16)).toBe(5)
    expect(heightAt(field, 48, 16)).toBe(2)
    expect(heightAt(field, 200, 16)).toBe(0)
  })

  test('continuation leaves the border with its falling slope, then settles at the context plane', () => {
    // y = 8 - x / 2 on [0,8]². Clamping would leave a visible 4 m plateau.
    const legacy = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
    for (let row = 0; row < 17; row++)
      for (let col = 0; col < 17; col++) legacy.heights[row * 17 + col] = 800 - col * 25
    const site = SiteNode.parse({ id: 'site_tiles', terrain: encodeTerrainField(legacy) })
    const field = persistedTerrainFieldOf(site, { [site.id]: site })
    if (!field) throw new Error('Missing virtual field')
    expect(heightAt(field, 8, 4)).toBe(4)
    expect(heightAt(field, 8.01, 4)).toBeCloseTo(3.995, 4)
    expect(heightAt(field, 9, 4)).toBeLessThan(4)
    expect(heightAt(field, 72, 4)).toBe(0)
    expect(heightAt(field, 100, 4)).toBe(0)
    expect(heightAt(field, 71.99, 4)).toBeCloseTo(0, 4)
  })

  test('zero legacy padding descends toward the frozen negative minimum, not a flat datum', () => {
    const legacy = createTerrainField({ cols: 65, rows: 65, spacing: 0.5, origin: [-16, -16] })
    legacy.heights[32 * 65 + 32] = -780
    const site = SiteNode.parse({ id: 'site_tiles', terrain: encodeTerrainField(legacy) })
    const nodes = { [site.id]: site }
    const field = persistedTerrainFieldOf(site, nodes)
    if (!field) throw new Error('Missing legacy ground')
    expect(heightAt(field, 0, 16)).toBe(0)
    expect(heightAt(field, 0, 20)).toBeLessThan(0)
    expect(heightAt(field, 0, 30)).toBeLessThan(heightAt(field, 0, 20))
    expect(heightAt(field, 0, 80)).toBe(-7.8)
    const distant = tile(4, 4, -20)
    const withTile = persistedTerrainFieldOf(site, { ...nodes, [distant.id]: distant })
    if (!withTile) throw new Error('Missing tiled ground')
    expect(heightAt(withTile, 0, 30)).toBe(heightAt(field, 0, 30))
    expect(heightAt(withTile, 0, 80)).toBe(-7.8)
  })
})
