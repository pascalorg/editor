import { describe, expect, test } from 'bun:test'
import { pointInPolygon2D, SlabNode } from '@pascal-app/core'
import { slabDefinition } from '../definition'

function getHeightHandle(slab: SlabNode) {
  const handles =
    typeof slabDefinition.handles === 'function'
      ? slabDefinition.handles(slab)
      : (slabDefinition.handles ?? [])
  const heightHandle = handles.find(
    (handle) => handle.kind === 'linear-resize' && handle.axis === 'y',
  )
  if (!(heightHandle && heightHandle.kind === 'linear-resize')) {
    throw new Error('Missing slab height handle')
  }
  return heightHandle
}

function getHeightHandlePosition(slab: SlabNode) {
  return getHeightHandle(slab).placement.position(slab, {} as never)
}

describe('slabDefinition handles', () => {
  test('keeps the height handle over solid slab area when the center is a hole', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      holes: [
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
      ],
    })

    const [x, , z] = getHeightHandlePosition(slab)

    expect(pointInPolygon2D([x, z], slab.polygon, { includeBoundary: false })).toBe(true)
    expect(pointInPolygon2D([x, z], slab.holes[0]!, { includeBoundary: true })).toBe(false)
  })

  test('allows the elevation arrow to cross zero into a recessed slab', () => {
    const slab = SlabNode.parse({
      elevation: 0.05,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const heightHandle = getHeightHandle(slab)

    expect(heightHandle.min).toBe(-1)
    expect(heightHandle.apply(slab, -0.15, {} as never)).toEqual({ elevation: -0.15 })
  })
})
