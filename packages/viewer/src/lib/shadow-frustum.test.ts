// @ts-expect-error - bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three/webgpu'
import { expandBoundsByGroundShadow } from './shadow-frustum'

describe('expandBoundsByGroundShadow', () => {
  test('includes the projected ground footprint for tall casters', () => {
    const source = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 20, 2))
    const lightDirection = new THREE.Vector3(10, 10, 10).normalize()
    const expanded = expandBoundsByGroundShadow(new THREE.Box3(), source, lightDirection, 0)

    expect(expanded.min.x).toBeLessThanOrEqual(-19)
    expect(expanded.min.z).toBeLessThanOrEqual(-19)
    expect(expanded.max.x).toBeGreaterThanOrEqual(2)
    expect(expanded.max.z).toBeGreaterThanOrEqual(2)
  })

  test('keeps the source bounds when the light is too close to horizontal', () => {
    const source = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 20, 2))
    const lightDirection = new THREE.Vector3(1, 0.01, 0).normalize()
    const expanded = expandBoundsByGroundShadow(new THREE.Box3(), source, lightDirection, 0)

    expect(expanded.min.toArray()).toEqual(source.min.toArray())
    expect(expanded.max.toArray()).toEqual(source.max.toArray())
  })
})
