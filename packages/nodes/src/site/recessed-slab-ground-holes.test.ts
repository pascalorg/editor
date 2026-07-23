import { describe, expect, test } from 'bun:test'
import { type AnyNode, SlabNode, WallNode } from '@pascal-app/core'
import { getRecessedSlabGroundHoles } from './recessed-slab-ground-holes'

describe('getRecessedSlabGroundHoles', () => {
  test('uses the rendered wall-face footprint instead of the stored centerline polygon', () => {
    const parentId = 'level_ground-holes'
    const slab = SlabNode.parse({
      id: 'slab_ground-holes',
      parentId,
      elevation: -0.15,
      recessed: true,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const walls = [
      WallNode.parse({ id: 'wall_ground-holes-a', parentId, start: [0, 0], end: [2, 0] }),
      WallNode.parse({ id: 'wall_ground-holes-b', parentId, start: [2, 0], end: [2, 2] }),
      WallNode.parse({ id: 'wall_ground-holes-c', parentId, start: [2, 2], end: [0, 2] }),
      WallNode.parse({ id: 'wall_ground-holes-d', parentId, start: [0, 2], end: [0, 0] }),
    ]
    const nodes = Object.fromEntries([slab, ...walls].map((node) => [node.id, node])) as Record<
      string,
      AnyNode
    >

    const [hole] = getRecessedSlabGroundHoles(nodes)
    const xs = hole!.map(([x]) => x)
    const zs = hole!.map(([, z]) => z)

    expect(Math.min(...xs)).toBeCloseTo(-0.05)
    expect(Math.max(...xs)).toBeCloseTo(2.05)
    expect(Math.min(...zs)).toBeCloseTo(-0.05)
    expect(Math.max(...zs)).toBeCloseTo(2.05)
  })

  test('excludes non-recessed slabs', () => {
    const slab = SlabNode.parse({
      id: 'slab_ground-holes-raised',
      elevation: 0.15,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })

    expect(getRecessedSlabGroundHoles({ [slab.id]: slab })).toEqual([])
  })

  test('keys on the recessed flag, not the elevation sign', () => {
    // A below-plane SOLID (deck underside) must not punch a ground hole.
    const slab = SlabNode.parse({
      id: 'slab_ground-holes-below-plane',
      elevation: -0.15,
      thickness: 0.3,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })

    expect(getRecessedSlabGroundHoles({ [slab.id]: slab })).toEqual([])
  })
})
