import { describe, expect, test } from 'bun:test'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { hasDrawableGeometry } from './drawable-geometry'

function triangleGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(9), 3))
  return geometry
}

describe('hasDrawableGeometry', () => {
  test('rejects missing and empty position buffers', () => {
    expect(hasDrawableGeometry(new BufferGeometry())).toBe(false)

    const empty = new BufferGeometry()
    empty.setAttribute('position', new Float32BufferAttribute(new Float32Array(), 3))
    expect(hasDrawableGeometry(empty)).toBe(false)
  })

  test('accepts a non-indexed geometry with an effective draw range', () => {
    expect(hasDrawableGeometry(triangleGeometry())).toBe(true)
  })

  test('rejects an empty index even when positions exist', () => {
    const geometry = triangleGeometry()
    geometry.setIndex([])

    expect(hasDrawableGeometry(geometry)).toBe(false)
  })

  test('rejects zero and disjoint draw ranges', () => {
    const zeroRange = triangleGeometry()
    zeroRange.setDrawRange(0, 0)
    expect(hasDrawableGeometry(zeroRange)).toBe(false)

    const pastEnd = triangleGeometry()
    pastEnd.setDrawRange(3, 3)
    expect(hasDrawableGeometry(pastEnd)).toBe(false)
  })

  test('uses the intersection of draw range and material group', () => {
    const geometry = triangleGeometry()
    expect(hasDrawableGeometry(geometry, { start: 0, count: 0, materialIndex: 0 })).toBe(false)
    expect(hasDrawableGeometry(geometry, { start: 3, count: 3, materialIndex: 0 })).toBe(false)
    expect(hasDrawableGeometry(geometry, { start: 1, count: 2, materialIndex: 0 })).toBe(true)
  })
})
