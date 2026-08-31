// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  calculateLevelMiters,
  getWallPlaneTop,
  WallNode,
} from '@pascal-app/core'
import { generateExtrudedWall } from './wall-system'

describe('wall support extension', () => {
  test('preserves the raised wall origin and top while filling down to the lower support', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], height: 2.5, thickness: 0.1 })
    const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]), 0.6, 0.05)
    geometry.computeBoundingBox()

    expect(geometry.boundingBox?.min.y).toBeCloseTo(-0.55)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2.5)
    // With mesh.position.y = 0.6, the wall spans world Y=0.05..3.1.
    expect((geometry.boundingBox?.min.y ?? 0) + 0.6).toBeCloseTo(0.05)
    expect((geometry.boundingBox?.max.y ?? 0) + 0.6).toBeCloseTo(3.1)

    geometry.dispose()
  })

  test('retains the existing negative-slab top constraint', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], height: 2.5, thickness: 0.1 })
    const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]), -0.4, -0.4)
    geometry.computeBoundingBox()

    expect(geometry.boundingBox?.min.y).toBeCloseTo(0)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2.9)
    expect((geometry.boundingBox?.max.y ?? 0) - 0.4).toBeCloseTo(2.5)

    geometry.dispose()
  })

  test('plane-bound wall tops out at the storey plane regardless of slab elevation', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.1 })

    const flat = generateExtrudedWall(wall, [], calculateLevelMiters([wall]), 0, 0, undefined, 3)
    flat.computeBoundingBox()
    expect(flat.boundingBox?.max.y).toBeCloseTo(3)
    expect(flat.boundingBox?.min.y).toBeCloseTo(0)
    flat.dispose()

    const raised = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters([wall]),
      0.6,
      0.6,
      undefined,
      3,
    )
    raised.computeBoundingBox()
    // Mesh sits at Y=0.6, so a 2.4 local top keeps the world top at the 3m
    // plane — the raised slab shortens the wall instead of lifting its top.
    expect(raised.boundingBox?.max.y).toBeCloseTo(2.4)
    expect(raised.boundingBox?.min.y).toBeCloseTo(0)
    raised.dispose()
  })

  test('plane-bound wall under a flush thick deck tops out at the deck underside', () => {
    // level_1 carries a flush deck occupying [-0.3, 0] above the storey
    // plane: the covering-clamped plane for level_0 is 2.5 − 0.3 = 2.2.
    const wall = WallNode.parse({
      start: [0.5, 2],
      end: [3.5, 2],
      thickness: 0.1,
      parentId: 'level_0',
    })
    const base = { object: 'node', parentId: null, visible: true, metadata: {}, children: [] }
    const nodes = {
      level_0: {
        ...base,
        id: 'level_0',
        type: 'level',
        level: 0,
        height: 2.5,
        children: [wall.id],
      },
      level_1: {
        ...base,
        id: 'level_1',
        type: 'level',
        level: 1,
        height: 2.5,
        children: ['slab_deck'],
      },
      slab_deck: {
        ...base,
        id: 'slab_deck',
        type: 'slab',
        parentId: 'level_1',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        holes: [],
        elevation: 0,
        thickness: 0.3,
      },
    } as unknown as Record<AnyNodeId, AnyNode>

    const planeTop = getWallPlaneTop(wall, 'level_0', nodes)
    expect(planeTop).toBeCloseTo(2.2)

    const geometry = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters([wall]),
      0,
      0,
      undefined,
      planeTop,
    )
    geometry.computeBoundingBox()
    // Mesh sits at Y=0, so the world top lands at the deck underside instead
    // of colliding with the slab solid above.
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2.2)
    expect(geometry.boundingBox?.min.y).toBeCloseTo(0)
    geometry.dispose()
  })

  test('raises only the high-supported part of a mixed wall run', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], height: 2.5, thickness: 0.1 })
    const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]), 0.6, 0.05, [
      { start: 0, end: 0.5, elevation: 0.6 },
      { start: 0.5, end: 1, elevation: 0.05 },
    ])
    const position = geometry.getAttribute('position')
    let highSpanMinY = Number.POSITIVE_INFINITY
    let lowSpanMinY = Number.POSITIVE_INFINITY
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index)
      const y = position.getY(index)
      if (x < 1.9) highSpanMinY = Math.min(highSpanMinY, y)
      if (x > 2.1) lowSpanMinY = Math.min(lowSpanMinY, y)
    }

    expect(highSpanMinY).toBeCloseTo(0)
    expect(lowSpanMinY).toBeCloseTo(-0.55)
    geometry.dispose()
  })
})
