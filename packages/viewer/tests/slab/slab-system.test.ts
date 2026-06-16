import { describe, expect, test } from 'bun:test'
import { SlabNode } from '@pascal-app/core'
import { type Box3, Vector3 } from 'three'
import { generateSlabGeometry } from '../../src/systems/slab/slab-system'

function firstTriangleNormalY(geometry: ReturnType<typeof generateSlabGeometry>) {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  if (!position) throw new Error('missing position attribute')
  const read = (i: number) => {
    const vertexIndex = index ? index.getX(i) : i
    return new Vector3(
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex),
    )
  }
  const a = read(0)
  const b = read(1)
  const c = read(2)
  return b.sub(a).cross(c.sub(a)).normalize().y
}

describe('generateSlabGeometry', () => {
  test('orients recessed slab floor upward for clockwise source polygons', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [0, 4],
        [4, 4],
        [4, 0],
      ],
      elevation: -0.15,
    })

    const geometry = generateSlabGeometry(slab)

    expect(firstTriangleNormalY(geometry)).toBeGreaterThan(0.9)

    geometry.dispose()
  })

  test('keeps manual recessed slab geometry on the raw drawn footprint', () => {
    const slab = SlabNode.parse({
      polygon: [
        [-3.5, 6],
        [-1.5, 4],
        [0, 4],
        [-1.5, 5.5],
        [-2.5, 6.5],
        [-3, 6],
      ],
      elevation: -1,
    })

    const geometry = generateSlabGeometry(slab)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox as Box3

    expect(box.min.x).toBeCloseTo(-3.5, 6)
    expect(box.max.x).toBeCloseTo(0, 6)
    expect(box.min.z).toBeCloseTo(4, 6)
    expect(box.max.z).toBeCloseTo(6.5, 6)

    geometry.dispose()
  })
})
