// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { clipGeometryByRegions } from './roof-clip'

/** Above y = 1 + 0.3 x, inside 0 ≤ x ≤ 4, 0 ≤ z ≤ 4. */
const region = [
  new THREE.Plane(new THREE.Vector3(-0.3, 1, 0), -1),
  new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), 4),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), 4),
]

function post(x: number, height = 3) {
  const geometry = new THREE.BoxGeometry(0.2, height, 0.2)
  geometry.translate(x, height / 2, 2)
  return geometry
}

describe('roof clip', () => {
  test('a post under the slope loses everything above the underside', () => {
    const clipped = clipGeometryByRegions(post(2), [region])!
    expect(clipped).not.toBeNull()
    const positions = clipped.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i)
      expect(positions.getY(i)).toBeLessThanOrEqual(1 + 0.3 * x + 1e-5)
    }
    clipped.computeBoundingBox()
    expect(clipped.boundingBox!.max.y).toBeCloseTo(1 + 0.3 * 2.1, 4)
    expect(clipped.boundingBox!.min.y).toBeCloseTo(0, 6)
  })

  test('a post outside the roof outline or below the underside stays as it is', () => {
    expect(clipGeometryByRegions(post(6), [region])).toBeNull()
    expect(clipGeometryByRegions(post(2, 0.8), [region])).toBeNull()
  })

  test('material groups survive the cut', () => {
    const clipped = clipGeometryByRegions(post(2), [region])!
    expect(new Set(clipped.groups.map((group) => group.materialIndex)).size).toBeGreaterThan(1)
    const total = clipped.groups.reduce((sum, group) => sum + group.count, 0)
    expect(total).toBe(clipped.getAttribute('position').count)
  })
})
