import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  createTerrainField,
  encodeTerrainField,
  persistedTerrainFieldOf,
  type TerrainTileNode,
  tileFieldOf,
} from '@pascal-app/core'
import {
  type AnyNode,
  SiteNode,
  TerrainBreakNode,
  TerrainTileNode as Tile,
} from '@pascal-app/core/schema'
import { buildTerrainGroundMesh } from '../site/terrain-ground'
import { breakLines, tileMeetsLot, tileNeighbours } from './mesh-inputs'

/*
 * Failure modes this file pins (the terrain lag, 15 Oct): a tile mesh was rebuilt whenever the
 * authority object changed, 24 meshes for one edited tile.
 * - the inputs a mesh is keyed on miss a tile it reads, so a stale mesh stays on screen;
 * - they name a tile or break it does not read, so nothing is saved.
 */

const SITE = 'site_tiles'

function tile(ix: number, iz: number, bump = 0): TerrainTileNode {
  const field = createTerrainField({
    origin: [ix * 32, iz * 32],
    spacing: 0.5,
    cols: 65,
    rows: 65,
    step: 0.01,
  })
  for (let row = 0; row < 65; row++)
    for (let col = 0; col < 65; col++)
      field.heights[row * 65 + col] = Math.round(
        100 * (-3 + Math.sin((ix * 32 + col * 0.5) / 9) * Math.cos((iz * 32 + row * 0.5) / 7)) +
          bump,
      )
  return Tile.parse({
    id: `terrain-tile_${ix}_${iz}`,
    parentId: SITE,
    ix,
    iz,
    level: 0,
    step: 0.01,
    heights: encodeTerrainField(field).heights,
  })
}

function scene(edited?: [number, number]) {
  const tiles = [-1, 0, 1].flatMap((iz) =>
    [-1, 0, 1].map((ix) => tile(ix, iz, edited && edited[0] === ix && edited[1] === iz ? 37 : 0)),
  )
  const ring = TerrainBreakNode.parse({
    id: 'terrain-break_ring',
    parentId: SITE,
    kind: 'retaining',
    line: [
      [-8, -5],
      [-2, -5],
      [-2, 4],
      [-8, 4],
      [-8, -5],
    ],
    left: -3.8,
    right: 'ground',
  })
  const site = SiteNode.parse({ id: SITE, children: [...tiles, ring].map((node) => node.id) })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [site, ...tiles, ring].map((node) => [node.id, node]),
  )
  return { site, nodes, tiles }
}

const hash = (a: ArrayBufferView) =>
  createHash('sha256')
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest('hex')
    .slice(0, 20)

function meshOf(s: ReturnType<typeof scene>, ix: number, iz: number) {
  const field = persistedTerrainFieldOf(s.site, s.nodes)!
  const found = s.tiles.find((candidate) => candidate.ix === ix && candidate.iz === iz)!
  const buffers = buildTerrainGroundMesh(tileFieldOf(found)!, field, [])
  return {
    positions: hash(buffers.positions),
    normals: hash(buffers.normals),
    indices: hash(buffers.indices),
  }
}

describe('a tile’s mesh is keyed on what it reads', () => {
  test('a tile two squares away changes neither a vertex of the mesh nor the neighbours it is keyed on', () => {
    const before = scene()
    const after = scene([1, 1])
    // The edited tile really is another ground now.
    expect(persistedTerrainFieldOf(after.site, after.nodes)).not.toBe(
      persistedTerrainFieldOf(before.site, before.nodes),
    )
    // Tile (-1, -1)'s neighbours are (0, -1), (-1, 0) and (0, 0); (1, 1) is not among them.
    const names = (s: ReturnType<typeof scene>) =>
      tileNeighbours({ ix: -1, iz: -1 }, s.tiles)
        .filter(Boolean)
        .map((entry) => entry!.id)
        .sort()
    expect(names(before)).toEqual(['terrain-tile_-1_0', 'terrain-tile_0_-1', 'terrain-tile_0_0'])
    expect(meshOf(after, -1, -1)).toEqual(meshOf(before, -1, -1))
    // …while the edited tile's own mesh is another mesh.
    expect(meshOf(after, 1, 1)).not.toEqual(meshOf(before, 1, 1))
  })

  test('the key names the eight neighbours and every break', () => {
    const s = scene()
    const centre = tileNeighbours({ ix: 0, iz: 0 }, s.tiles)
    expect(centre).toHaveLength(8)
    expect(centre.every(Boolean)).toBe(true)
    expect(tileNeighbours({ ix: 1, iz: 1 }, s.tiles).filter(Boolean)).toHaveLength(3)
    expect(breakLines(persistedTerrainFieldOf(s.site, s.nodes)!)).toHaveLength(1)
  })
})

describe('a tile is drawn only where the property line can show it', () => {
  const lot: [number, number][] = [
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
  ]

  test('a 30 m lot about the origin shows the four tiles that meet there, of the 24 a slope wrote', () => {
    const drawn: string[] = []
    for (let iz = -3; iz <= 2; iz++)
      for (let ix = -2; ix <= 1; ix++) if (tileMeetsLot({ ix, iz }, lot)) drawn.push(`${ix},${iz}`)
    expect(drawn).toEqual(['-1,-1', '0,-1', '-1,0', '0,0'])
  })

  test('a tile the line only touches is drawn, and so is everything while the line is not a polygon', () => {
    const edge: [number, number][] = [
      [32, 4],
      [50, 4],
      [50, 20],
      [32, 20],
    ]
    expect(tileMeetsLot({ ix: 0, iz: 0 }, edge)).toBe(true)
    expect(tileMeetsLot({ ix: 1, iz: 0 }, edge)).toBe(true)
    expect(tileMeetsLot({ ix: 2, iz: 0 }, edge)).toBe(false)
    expect(tileMeetsLot({ ix: 5, iz: 5 }, [])).toBe(true)
    expect(
      tileMeetsLot({ ix: 5, iz: 5 }, [
        [0, 0],
        [Number.NaN, 4],
        [4, 4],
      ]),
    ).toBe(true)
  })
})
