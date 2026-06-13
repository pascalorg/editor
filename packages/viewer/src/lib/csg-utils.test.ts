// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { ensureRenderableGeometryAttributes } from './csg-utils'

describe('ensureRenderableGeometryAttributes', () => {
  test('fills missing render attributes to match position count', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    )

    ensureRenderableGeometryAttributes(geometry)

    expect(geometry.getAttribute('position')?.count).toBe(3)
    expect(geometry.getAttribute('normal')?.count).toBe(3)
    expect(geometry.getAttribute('uv')?.count).toBe(3)
    expect(geometry.getAttribute('uv2')?.count).toBe(3)
  })

  test('replaces render attributes with the wrong item size', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    )
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array([0, 0, 0]), 1))
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array([0, 0, 0]), 1))

    ensureRenderableGeometryAttributes(geometry)

    expect(geometry.getAttribute('uv')?.itemSize).toBe(2)
    expect(geometry.getAttribute('uv2')?.itemSize).toBe(2)
    expect(geometry.getAttribute('uv')?.count).toBe(3)
    expect(geometry.getAttribute('uv2')?.count).toBe(3)
  })

  test('copies uv into uv2 without depending on backing array layout', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    )
    geometry.setAttribute(
      'uv',
      new THREE.InterleavedBufferAttribute(
        new THREE.InterleavedBuffer(new Float32Array([0, 0, 7, 1, 0, 8, 0, 1, 9]), 3),
        2,
        0,
      ),
    )

    ensureRenderableGeometryAttributes(geometry)

    const uv2 = geometry.getAttribute('uv2')
    expect(Array.from(uv2.array)).toEqual([0, 0, 1, 0, 0, 1])
  })

  test('replaces empty geometries with a degenerate renderable triangle', () => {
    const geometry = new THREE.BufferGeometry()

    ensureRenderableGeometryAttributes(geometry)

    expect(geometry.getIndex()).toBeNull()
    expect(geometry.groups).toHaveLength(0)
    expect(geometry.getAttribute('position')?.count).toBe(3)
    expect(geometry.getAttribute('normal')?.count).toBe(3)
    expect(geometry.getAttribute('uv')?.count).toBe(3)
    expect(geometry.getAttribute('uv2')?.count).toBe(3)
  })
})
