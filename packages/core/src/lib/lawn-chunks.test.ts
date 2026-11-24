import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  buildLawn,
  buildLawnChunk,
  buildLawnChunkFlowers,
  commitTerrainField,
  createTerrainField,
  LAWN_CHUNK_M,
  LawnNode,
  type LawnStroke,
  lawnChunkContext,
  lawnChunksTouched,
  lawnGroundChunkAt,
  planLawn,
  SiteNode,
  SlabNode,
} from '../index'

type Point = [number, number]
const rectangle = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const bytes = (view: ArrayBufferView) =>
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength)

function scene(outline: Point[], props: Record<string, unknown> = {}, extra: AnyNode[] = []) {
  const site = SiteNode.parse({
    id: 'site_chunks',
    polygon: { type: 'polygon', points: outline },
    ...(props.terrain ? { terrain: props.terrain } : {}),
  })
  const { terrain: _terrain, ...lawnProps } = props
  const lawn = LawnNode.parse({
    id: 'lawn_chunks',
    parentId: site.id,
    outline,
    seed: 19,
    ...lawnProps,
  })
  const nodes: Record<string, AnyNode> = { [site.id]: site, [lawn.id]: lawn }
  for (const node of extra) nodes[node.id] = node
  return { lawn, nodes }
}

/** Every ground triangle as one text record: the order of triangles does not reach the picture. */
function triangles(base: ReturnType<typeof buildLawn>['base']): string[] {
  const records: string[] = []
  for (let triangle = 0; triangle < base.indices.length / 3; triangle++)
    records.push(
      [
        base.positions.subarray(triangle * 9, triangle * 9 + 9),
        base.normals.subarray(triangle * 9, triangle * 9 + 9),
        base.colors.subarray(triangle * 9, triangle * 9 + 9),
        base.cover?.subarray(triangle * 3, triangle * 3 + 3) ?? [],
      ]
        .map((part) => Array.from(part).join(','))
        .join('|'),
    )
  return records
}

/**
 * Paints one stroke sample by sample the way the live lawn does: only the chunks the change of
 * strokes can touch are rebuilt, every other chunk keeps what the build before the stroke gave.
 * Returns how many chunks each sample rebuilt, after checking the result against a full build.
 */
function paint(
  lawn: LawnNode,
  nodes: Record<string, AnyNode>,
  settings: Omit<LawnStroke, 'points'>,
  samples: Point[][],
): number[] {
  const context = lawnChunkContext(lawn, nodes)
  const before = buildLawn(lawn, nodes)
  const blades = new Map<string, { rootHeight: Float32Array; traits: Float32Array }>()
  for (const chunk of before.blades.chunks)
    blades.set(chunk.key, {
      rootHeight: before.blades.rootHeight.slice(chunk.start * 4, (chunk.start + chunk.count) * 4),
      traits: before.blades.traits.slice(chunk.start * 4, (chunk.start + chunk.count) * 4),
    })
  const ground = new Map<string, string[]>()
  for (
    let chunkZ = Math.floor(context.cells.minZ / LAWN_CHUNK_M);
    chunkZ <= Math.floor(context.cells.maxZ / LAWN_CHUNK_M);
    chunkZ++
  )
    for (
      let chunkX = Math.floor(context.cells.minX / LAWN_CHUNK_M);
      chunkX <= Math.floor(context.cells.maxX / LAWN_CHUNK_M);
      chunkX++
    )
      ground.set(
        `${chunkX},${chunkZ}`,
        triangles(buildLawnChunk(context, lawn, chunkX, chunkZ).base),
      )
  // The chunked ground of the unpainted lawn is the full ground, triangle for triangle.
  expect([...ground.values()].flat().sort()).toEqual(triangles(before.base).sort())

  let current = lawn
  const rebuilt: number[] = []
  for (const points of samples) {
    const next = LawnNode.parse({ ...lawn, strokes: [...lawn.strokes, { ...settings, points }] })
    const touched = lawnChunksTouched(context, current.strokes, next.strokes)
    rebuilt.push(touched.length)
    for (const [chunkX, chunkZ] of touched) {
      const chunk = buildLawnChunk(context, next, chunkX, chunkZ)
      if (chunk.count) blades.set(chunk.key, chunk)
      else blades.delete(chunk.key)
      ground.set(chunk.key, triangles(chunk.base))
    }
    current = next
  }

  const full = buildLawn(current, nodes)
  expect([...blades.keys()].sort()).toEqual(full.blades.chunks.map((chunk) => chunk.key).sort())
  let count = 0
  for (const chunk of full.blades.chunks) {
    const live = blades.get(chunk.key)
    if (!live) throw new Error(`Chunk ${chunk.key} is missing`)
    count += live.rootHeight.length / 4
    const from = chunk.start * 4,
      to = (chunk.start + chunk.count) * 4
    expect(bytes(live.rootHeight)).toEqual(bytes(full.blades.rootHeight.subarray(from, to)))
    expect(bytes(live.traits)).toEqual(bytes(full.blades.traits.subarray(from, to)))
  }
  expect(count).toBe(full.facts.bladeCount)
  // With a bare stroke the full ground carries a cover attribute; so does every rebuilt chunk.
  // Chunks the stroke never reached were built before it and carry none: there cover is 1.
  const cover = (records: string[]) =>
    full.base.cover
      ? records.map((record) => (record.endsWith('|') ? `${record}1,1,1` : record))
      : records
  expect(cover([...ground.values()].flat()).sort()).toEqual(triangles(full.base).sort())
  const flowers = buildLawnChunkFlowers(context, current)
  for (const part of ['positions', 'normals', 'colors', 'uv', 'headIndexEnds'] as const)
    expect(bytes(flowers[part])).toEqual(bytes(full.flowers[part]))
  expect(flowers.count).toBe(full.facts.flowerCount)
  return rebuilt
}

/** A pointer path as the successive point lists of one stroke in progress. */
const growing = (path: Point[]): Point[][] => path.map((_, index) => path.slice(0, index + 1))
const line = (from: Point, to: Point, steps: number): Point[] =>
  Array.from({ length: steps + 1 }, (_, index) => [
    from[0] + ((to[0] - from[0]) * index) / steps,
    from[1] + ((to[1] - from[1]) * index) / steps,
  ])

const lot = rectangle(-10, -15, 10, 15)
const bare = { radiusM: 0.5, effect: 'bare', strength: 1 } as const

describe('a stroke painted chunk by chunk equals the full build of the same lawn', () => {
  test('a long diagonal across many chunks', () => {
    const { lawn, nodes } = scene(lot)
    const rebuilt = paint(lawn, nodes, bare, growing(line([-9, -14], [9, 14], 40)))
    expect(Math.max(...rebuilt)).toBeLessThanOrEqual(4)
  }, 60_000)

  test('along the edge of the lawn, where blades are trimmed and faded', () => {
    const { lawn, nodes } = scene(lot, { edgeFade: 0.4 })
    paint(
      lawn,
      nodes,
      { radiusM: 0.8, effect: 'taller', strength: 1 },
      growing(line([-10, -14], [-9.8, 14], 30)),
    )
  }, 60_000)

  test('beside paving and a house that the lawn keeps clear', () => {
    const path = SlabNode.parse({
      id: 'slab_walk',
      parentId: 'site_chunks',
      polygon: rectangle(-0.6, -4, 0.6, 15),
      metadata: { flatwork: 'walk' },
    })
    const { lawn, nodes } = scene(lot, {}, [path])
    paint(lawn, nodes, bare, growing(line([-3, 2], [3, 9], 30)))
  }, 60_000)

  test('more flowers on a flowering lawn: the flower count changes', () => {
    const { lawn, nodes } = scene(lot, {
      flowers: [{ species: 'daisy', share: 1 }],
      flowerDensity: 0.6,
    })
    const before = buildLawn(lawn, nodes).facts.flowerCount
    const samples = growing(line([-6, 6], [6, 9], 20))
    paint(lawn, nodes, { radiusM: 1.5, effect: 'more-flowers', strength: 1 }, samples)
    const after = buildLawn(
      LawnNode.parse({
        ...lawn,
        strokes: [{ radiusM: 1.5, effect: 'more-flowers', strength: 1, points: samples.at(-1) }],
      }),
      nodes,
    ).facts.flowerCount
    expect(after).not.toBe(before)
  }, 60_000)

  test('a tail that is replaced, not only extended, as the hand simplifies its path', () => {
    const { lawn, nodes } = scene(lot)
    const samples: Point[][] = [
      [[1, 1]],
      [
        [1, 1],
        [1.4, 1.02],
      ],
      [
        [1, 1],
        [2.6, 1.05],
      ],
      [
        [1, 1],
        [2.6, 1.05],
        [2.7, 2.9],
      ],
      [
        [1, 1],
        [2.6, 1.05],
        [8.4, 1.3],
      ],
    ]
    paint(lawn, nodes, { radiusM: 0.3, effect: 'bare', strength: 1 }, samples)
  }, 60_000)

  test('a wide brush on sloped ground, on a lawn that already carries strokes', () => {
    const field = createTerrainField({ origin: [-10, -15], cols: 21, rows: 31, spacing: 1 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++)
        field.heights[row * field.cols + col] = Math.round(col * 5 + 25 * Math.sin(row / 6))
    const { lawn, nodes } = scene(lot, {
      terrain: commitTerrainField(field),
      strokes: [
        { radiusM: 1, effect: 'bare', strength: 0.7, points: [[-5, -5]] },
        {
          radiusM: 0.6,
          effect: 'shorter',
          strength: 1,
          points: [
            [4, 4],
            [7, 9],
          ],
        },
      ],
    })
    paint(
      lawn,
      nodes,
      { radiusM: 3, effect: 'taller', strength: 0.8 },
      growing(line([-8, 0], [8, 3], 12)),
    )
  }, 60_000)
})

test('on a terrain grid that does not line up with the chunks, the chunked ground is still exact', () => {
  const field = createTerrainField({ origin: [-10.3, -15.2], cols: 30, rows: 44, spacing: 0.7 })
  for (let index = 0; index < field.heights.length; index++)
    field.heights[index] = Math.round(20 * Math.sin(index / 7))
  const { lawn, nodes } = scene(lot, { terrain: commitTerrainField(field) })
  paint(lawn, nodes, bare, growing(line([-9, 7.4], [9, 8.6], 30)))
  paint(lawn, nodes, bare, growing(line([7.5, -14], [8.5, 14], 30)))
}, 60_000)

test('a sample rebuilds the chunks under the brush, on a 30 m2 and on a 2,000 m2 lawn alike', () => {
  const small = scene(rectangle(-3, -2.5, 3, 2.5))
  const large = scene(rectangle(-20, -25, 20, 25))
  const path = growing(line([-2, -1], [2, 1.5], 40))
  const onSmall = paint(small.lawn, small.nodes, bare, path)
  const onLarge = paint(large.lawn, large.nodes, bare, path)
  // The same brush on the same path: the size of the lawn does not change what is rebuilt.
  expect(Math.max(...onLarge)).toBeLessThanOrEqual(4)
  expect(onLarge.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(
    onSmall.reduce((sum, count) => sum + count, 0),
  )
  expect(buildLawn(large.lawn, large.nodes).blades.chunks.length).toBeGreaterThan(20)
}, 60_000)

test('every ground triangle of the full build is named by the chunk that builds it', () => {
  const field = createTerrainField({ origin: [-10.3, -15.2], cols: 30, rows: 44, spacing: 0.7 })
  const { lawn, nodes } = scene(lot, { terrain: commitTerrainField(field) })
  const context = lawnChunkContext(lawn, nodes)
  const full = buildLawn(lawn, nodes).base
  const byChunk = new Map<string, string[]>()
  const records = triangles(full)
  for (let triangle = 0; triangle < records.length; triangle++) {
    const at = (corner: number, axis: number) =>
      full.positions[triangle * 9 + corner * 3 + axis] ?? 0
    const key = lawnGroundChunkAt(
      context,
      (at(0, 0) + at(1, 0) + at(2, 0)) / 3,
      (at(0, 2) + at(1, 2) + at(2, 2)) / 3,
    )
    byChunk.set(key, [...(byChunk.get(key) ?? []), records[triangle] ?? ''])
  }
  expect(byChunk.size).toBeGreaterThan(4)
  for (const [key, expected] of byChunk) {
    const [chunkX, chunkZ] = key.split(',').map(Number)
    const chunk = buildLawnChunk(context, lawn, chunkX ?? 0, chunkZ ?? 0)
    expect(triangles(chunk.base).sort()).toEqual(expected.sort())
  }
}, 60_000)

test('a plan that carries its stroke-independent parts from sample to sample is the same plan', () => {
  const path = SlabNode.parse({
    id: 'slab_walk',
    parentId: 'site_chunks',
    polygon: rectangle(-0.6, -4, 0.6, 15),
    metadata: { flatwork: 'walk' },
  })
  const { lawn, nodes } = scene(
    lot,
    { flowers: [{ species: 'daisy', share: 1 }], flowerDensity: 0.6 },
    [path],
  )
  const memo = {}
  for (const points of growing(line([-6, -3], [7, 9], 12))) {
    const next = LawnNode.parse({ ...lawn, strokes: [{ ...bare, points }] })
    const carried = planLawn(next, nodes, memo)
    const fresh = planLawn(next, nodes)
    expect(carried.facts).toEqual(fresh.facts)
    expect(carried.triangles).toEqual(fresh.triangles)
    expect(carried.polygons).toEqual(fresh.polygons)
  }
  // Another scene snapshot, or another outline, starts again from nothing.
  const moved = {
    ...nodes,
    [path.id]: SlabNode.parse({ ...path, polygon: rectangle(3, -4, 4.2, 15) }),
  }
  expect(planLawn(lawn, moved, memo).facts).toEqual(planLawn(lawn, moved).facts)
  const smaller = LawnNode.parse({ ...lawn, outline: rectangle(-5, -5, 5, 5) })
  expect(planLawn(smaller, moved, memo).facts).toEqual(planLawn(smaller, moved).facts)
  // A stroke that breaks the work budget is refused with the same error either way.
  const heavy = LawnNode.parse({
    ...lawn,
    strokes: Array.from({ length: 4 }, () => ({
      ...bare,
      points: Array.from({ length: 128 }, (_, index): Point => [1 + index / 128, 1]),
    })),
  })
  const refusal = (run: () => unknown) => {
    try {
      run()
      return null
    } catch (error) {
      return String(error)
    }
  }
  const warm = {}
  planLawn(lawn, nodes, warm)
  expect(refusal(() => planLawn(heavy, nodes, warm))).toBe(refusal(() => planLawn(heavy, nodes)))
  expect(refusal(() => planLawn(heavy, nodes))).toMatch(/32,000,000/)
}, 60_000)
