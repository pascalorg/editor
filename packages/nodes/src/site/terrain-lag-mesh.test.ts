import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { persistedTerrainFieldOf, terrainTilesOf, tileFieldOf } from '@pascal-app/core'
import { terrainLagScenes } from '../../../core/src/lib/__fixtures__/terrain-lag-scenes'
import golden from './__fixtures__/terrain-lag-mesh-golden.json'
import { buildTerrainGroundMesh } from './terrain-ground'

/*
 * Failure modes this file pins (the terrain lag, 15 Oct): a tile mesh was built in seconds because
 * every vertex read the break-aware authority the slow way. The golden hashes are the buffers the
 * build before the speed-up produced, byte for byte, on scenes with closed and open breaks.
 */

const hash = (array: ArrayBufferView) =>
  createHash('sha256')
    .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex')
    .slice(0, 24)

type Mesh = {
  id: string
  positions: string
  normals: string
  indices: string
  verts: number
  tris: number
}

describe('a tile mesh is the same buffers as before the speed-up', () => {
  for (const scene of terrainLagScenes()) {
    const expected = (golden as unknown as Record<string, Mesh[]>)[scene.name]
    if (!expected?.length) continue
    test(`${scene.name}: positions, normals and indices, byte for byte`, () => {
      const field = persistedTerrainFieldOf(scene.site, scene.nodes)!
      const tiles = terrainTilesOf(scene.site, scene.nodes)
      const picked = tiles.filter((_, index) => [0, 4, 7].includes(index))
      expect(picked.map((tile) => tile.id)).toEqual(expected.map((mesh) => mesh.id))
      picked.forEach((tile, index) => {
        const buffers = buildTerrainGroundMesh(tileFieldOf(tile)!, field, [])
        const want = expected[index]!
        expect({
          positions: hash(buffers.positions),
          normals: hash(buffers.normals),
          indices: hash(buffers.indices),
          verts: buffers.positions.length / 3,
          tris: buffers.indices.length / 3,
        }).toEqual({
          positions: want.positions,
          normals: want.normals,
          indices: want.indices,
          verts: want.verts,
          tris: want.tris,
        })
      })
    })
  }
})
