import { describe, expect, test } from 'bun:test'
import { createTerrainField, encodeTerrainField, persistedTerrainFieldOf } from '@pascal-app/core'
import { SiteNode, TerrainTileNode } from '@pascal-app/core/schema'
import {
  buildTerrainGroundMesh,
  buildTerrainTileMesh,
  terrainGroundPatches,
} from '@pascal-app/nodes'

function slopedTile(ix: number) {
  const field = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
  // y = x/5 has exact centimetre samples on the half-metre lattice.
  for (let row = 0; row < 65; row++)
    for (let col = 0; col < 65; col++) field.heights[row * 65 + col] = ix * 640 + col * 10
  return TerrainTileNode.parse({
    id: `terrain-tile_${ix}`,
    parentId: 'site_mesh',
    ix,
    iz: 0,
    level: 0,
    step: 0.01,
    heights: encodeTerrainField(field).heights,
  })
}

// CPU rendering contract: shared world positions/normals, plus disjoint base
// and tile coverage. Material/GPU lot clipping is a separate integration check.
describe('tiled terrain meshes', () => {
  test('a 10 km lot uses bounded continuation geometry without losing coverage or tile masking', () => {
    const base = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
    const tile = slopedTile(1)
    const site = SiteNode.parse({
      id: 'site_mesh',
      terrain: encodeTerrainField(base),
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [10_000, 0],
          [10_000, 10_000],
          [0, 10_000],
        ],
      },
    })
    const field = persistedTerrainFieldOf(site, { [site.id]: site, [tile.id]: tile })
    if (!field) throw new Error('Missing ground')
    const NativeInt16Array = globalThis.Int16Array
    let allocations = 0
    // Stop the unbounded old path safely rather than allocating 98,000 tile grids.
    globalThis.Int16Array = new Proxy(NativeInt16Array, {
      construct(target, args, newTarget) {
        allocations++
        if (allocations > 16) throw new Error('Unbounded continuation grid allocation')
        return Reflect.construct(target, args, newTarget)
      },
    })
    let patches: ReturnType<typeof terrainGroundPatches>
    try {
      patches = terrainGroundPatches(site, [tile])
    } finally {
      globalThis.Int16Array = NativeInt16Array
    }
    expect(patches.length).toBeLessThanOrEqual(2)
    let area = 0
    for (const patch of patches) {
      expect(patch.grid.cols * patch.grid.rows).toBeLessThanOrEqual(65 * 65)
      const mesh = buildTerrainGroundMesh(patch.grid, field, patch.holes)
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = (mesh.indices[i] ?? 0) * 3
        const b = (mesh.indices[i + 1] ?? 0) * 3
        const c = (mesh.indices[i + 2] ?? 0) * 3
        const ax = mesh.positions[a] ?? 0,
          az = mesh.positions[a + 2] ?? 0
        const bx = mesh.positions[b] ?? 0,
          bz = mesh.positions[b + 2] ?? 0
        const cx = mesh.positions[c] ?? 0,
          cz = mesh.positions[c + 2] ?? 0
        const x = (ax + bx + cx) / 3,
          z = (az + bz + cz) / 3
        expect(x > 32 && x < 64 && z > 0 && z < 32).toBe(false)
        area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2
      }
    }
    // Whole lot less one independently rendered 32 m tile. Half a square metre
    // tolerance accommodates Float32 vertex storage over a 100,000,000 m² domain.
    expect(area).toBeCloseTo(100_000_000 - 32 * 32, 0)
  })

  test('adjacent meshes have identical heights and analytic normals along the shared edge', () => {
    const site = SiteNode.parse({ id: 'site_mesh' })
    const left = slopedTile(0)
    const right = slopedTile(1)
    const field = persistedTerrainFieldOf(site, {
      [site.id]: site,
      [left.id]: left,
      [right.id]: right,
    })
    if (!field) throw new Error('Missing virtual terrain')
    const a = buildTerrainTileMesh(left, field)
    const b = buildTerrainTileMesh(right, field)
    expect(a.positions).toHaveLength(65 * 65 * 3)
    expect(b.positions).toHaveLength(65 * 65 * 3)
    // Stay one sample inside the exterior Z borders: only the internal seam is at issue.
    for (let row = 1; row < 64; row++) {
      const ai = (row * 65 + 64) * 3
      const bi = row * 65 * 3
      for (let axis = 0; axis < 3; axis++) {
        expect(a.positions[ai + axis]).toBe(b.positions[bi + axis])
        expect(a.normals[ai + axis]).toBe(b.normals[bi + axis])
      }
      expect(a.positions[ai]).toBe(32)
      expect(a.positions[ai + 1]).toBeCloseTo(6.4, 5)
      expect(a.normals[ai]).toBeCloseTo(-1 / Math.sqrt(26), 6)
      expect(a.normals[ai + 1]).toBeCloseTo(5 / Math.sqrt(26), 6)
      expect(a.normals[ai + 2]).toBeCloseTo(0, 6)
    }
  })

  test('authored tiles remove covered legacy triangles without losing the uncovered legacy ground', () => {
    const legacy = createTerrainField({ cols: 129, rows: 65, spacing: 0.5 })
    legacy.heights.fill(100)
    const tile = slopedTile(0)
    const site = SiteNode.parse({
      id: 'site_mesh',
      terrain: encodeTerrainField(legacy),
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [64, 0],
          [64, 32],
          [0, 32],
        ],
      },
    })
    const frozen = JSON.stringify(site.terrain)
    const field = persistedTerrainFieldOf(site, { [site.id]: site, [tile.id]: tile })
    if (!field) throw new Error('Missing virtual terrain')
    let uncoveredArea = 0
    for (const patch of terrainGroundPatches(site, [tile])) {
      const mesh = buildTerrainGroundMesh(patch.grid, field, patch.holes)
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = (mesh.indices[i] ?? 0) * 3
        const b = (mesh.indices[i + 1] ?? 0) * 3
        const c = (mesh.indices[i + 2] ?? 0) * 3
        const ax = mesh.positions[a] ?? 0,
          az = mesh.positions[a + 2] ?? 0
        const bx = mesh.positions[b] ?? 0,
          bz = mesh.positions[b + 2] ?? 0
        const cx = mesh.positions[c] ?? 0,
          cz = mesh.positions[c + 2] ?? 0
        const x = (ax + bx + cx) / 3,
          z = (az + bz + cz) / 3
        expect(x > 0 && x < 32 && z > 0 && z < 32).toBe(false)
        if (x > 32 && x < 64 && z > 0 && z < 32)
          uncoveredArea += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2
      }
    }
    expect(uncoveredArea).toBeCloseTo(32 * 32, 6)
    expect(JSON.stringify(site.terrain)).toBe(frozen)
  })
})
