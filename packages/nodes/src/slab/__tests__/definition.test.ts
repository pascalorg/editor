import { describe, expect, test } from 'bun:test'
import { pointInPolygon2D, SlabNode } from '@pascal-app/core'
import { slabDefinition } from '../definition'

function getHeightHandlePosition(slab: SlabNode) {
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
  return heightHandle.placement.position(slab, {} as never)
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
})
