import { describe, expect, test } from 'bun:test'
import { porchFor } from './porch'
import { stairFollowPatches } from './porch-follow'
import { styleFor } from './styles'

const FT = 0.3048
const IN = 0.0254

type N = Record<string, any>

/** A generated 20 ft farmhouse porch as a node map (the stair yawed 0: the edge runs along x). */
function porchNodes(): { nodes: Record<string, N>; stairId: string } {
  let n = 0
  const r = porchFor(
    {
      policy: 'full',
      style: styleFor('farmhouse'),
      levelId: 'level_1',
      wall: { start: [0, 0], end: [40 * FT, 0], thickness: 0.17 },
      doorAt: 20 * FT,
      doorWidth: 36 * IN,
      outward: [0, -1],
      bayWidth: 26 * FT,
      floorElevation: 0.05,
      gradeY: -0.2032,
      overhang: 0.3,
    },
    {
      slab: 'slab_porch',
      roof: 'roof_porch',
      segment: 'rseg_porch',
      stair: 'stair_porch',
      stairSegment: 'sseg_porch',
      beam: 'slab_beam',
      ceiling: 'ceiling_porch',
      column: () => `column_${++n}`,
      fence: () => `fence_${++n}`,
    },
  )
  const nodes: Record<string, N> = {}
  for (const op of r.ops) nodes[op.node.id as string] = { ...op.node }
  return { nodes, stairId: 'stair_porch' }
}

describe('the posts follow the stair', () => {
  test('the generator tags one post each side of the flight as its flank', () => {
    const { nodes } = porchNodes()
    const posts = Object.values(nodes).filter((x) => x.type === 'column')
    const flank = posts.filter((p) => p.metadata?.post?.flank === true)
    expect(posts).toHaveLength(4)
    expect(flank).toHaveLength(2)
    const xs = flank.map((p) => p.position[0]).sort((a, b) => a - b)
    // centred on the door (x = 20 ft), 30 in + a post's half + 1 in each side
    expect(xs[0]).toBeCloseTo(20 * FT - (30 + 2.75 + 1) * IN, 4)
    expect(xs[1]).toBeCloseTo(20 * FT + (30 + 2.75 + 1) * IN, 4)
  })

  test('sliding the stair 2 ft along the porch edge slides the two flanking posts 2 ft, the corners stay', () => {
    const { nodes, stairId } = porchNodes()
    const before = nodes[stairId]!.position as [number, number, number]
    const moved = { ...nodes, [stairId]: { ...nodes[stairId]!, position: [before[0] + 2 * FT, before[1], before[2]] } }
    const patches = stairFollowPatches(moved, stairId, { position: before })
    expect(patches).toHaveLength(2)
    for (const patch of patches) {
      const was = nodes[patch.id]!.position as number[]
      expect(patch.position[0]).toBeCloseTo(was[0]! + 2 * FT, 4)
      expect(patch.position[2]).toBeCloseTo(was[2]!, 6)
      expect(nodes[patch.id]!.metadata.post.flank).toBe(true)
    }
  })

  test('pulling the stair away from the porch (square to the edge) moves no post', () => {
    const { nodes, stairId } = porchNodes()
    const before = nodes[stairId]!.position as [number, number, number]
    const moved = { ...nodes, [stairId]: { ...nodes[stairId]!, position: [before[0], before[1], before[2] - 1] } }
    expect(stairFollowPatches(moved, stairId, { position: before })).toHaveLength(0)
  })

  test('a hand-made stair, or a nudge under 2 mm, moves nothing', () => {
    const { nodes, stairId } = porchNodes()
    const before = nodes[stairId]!.position as [number, number, number]
    const nudged = { ...nodes, [stairId]: { ...nodes[stairId]!, position: [before[0] + 0.001, before[1], before[2]] } }
    expect(stairFollowPatches(nudged, stairId, { position: before })).toHaveLength(0)
    const foreign = { ...nodes, [stairId]: { ...nodes[stairId]!, metadata: {}, position: [before[0] + 1, before[1], before[2]] } }
    expect(stairFollowPatches(foreign, stairId, { position: before })).toHaveLength(0)
  })
})
