import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { persistedTerrainFieldOf, terrainTilesOf } from '@pascal-app/core'
import { terrainLagScenes } from '../../../core/src/lib/__fixtures__/terrain-lag-scenes'
import golden from './__fixtures__/terrain-lag-break-golden.json'
import { buildTerrainBreakMesh, terrainBreakSources } from './geometry'

/*
 * Scaffolding of the terrain-lag speed-up (delete when it lands, T-001): the break faces were
 * built from a full ground mesh of every grid for every break, 22 s on the owner's scene. The
 * goldens are the position, normal, uv and index buffers and the region sides the build before
 * produced, for every (break, grid) pair of two scenes.
 */

const hash = (array: ArrayBufferView) =>
  createHash('sha256')
    .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex')
    .slice(0, 24)

type Row = {
  id: string
  key: string
  positions?: string
  normals?: string
  uvs?: string
  indices?: string
  sides?: string
  quads?: number
  refused?: string
}

describe('break faces are the same buffers as before the speed-up', () => {
  for (const scene of terrainLagScenes()) {
    const expected = (golden as unknown as Record<string, Row[]>)[scene.name]
    if (!expected) continue
    test(`${scene.name}: every (break, grid) pair, buffer for buffer`, () => {
      const field = persistedTerrainFieldOf(scene.site, scene.nodes)!
      const tiles = terrainTilesOf(scene.site, scene.nodes)
      const sources = terrainBreakSources(
        scene.site,
        Object.fromEntries([scene.site, ...tiles].map((node) => [node.id, node])),
      )
      const polygon = scene.site.polygon.points.map(([x, z]) => [x, z] as [number, number])
      const read: Row[] = []
      for (const boundary of field.terrainBreaks ?? [])
        for (const source of sources) {
          const buffers = buildTerrainBreakMesh(
            boundary,
            field,
            [source.grid],
            source.holes,
            polygon,
          )
          read.push({
            id: boundary.id,
            key: source.key,
            positions: hash(buffers.positions),
            normals: hash(buffers.normals),
            uvs: hash(buffers.uvs),
            indices: hash(buffers.indices),
            sides: createHash('sha256')
              .update(JSON.stringify(buffers.terrainBreakSides))
              .digest('hex')
              .slice(0, 24),
            quads: buffers.positions.length / 12,
          })
        }
      expect(read).toEqual(expected)
    })
  }
})
