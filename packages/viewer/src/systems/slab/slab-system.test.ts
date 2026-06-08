// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { SlabNode } from '@pascal-app/core'
import type * as THREE from 'three'
import { generateSlabGeometry } from './slab-system'

function hasVertexAt(geometry: THREE.BufferGeometry, x: number, z: number) {
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index += 1) {
    if (Math.abs(positions.getX(index) - x) < 1e-6 && Math.abs(positions.getZ(index) - z) < 1e-6) {
      return true
    }
  }
  return false
}

describe('generateSlabGeometry', () => {
  test('renders a boundary-overlapping hole as an open indentation', () => {
    const slab = SlabNode.parse({
      elevation: 0.05,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [
        [
          [1, -0.5],
          [3, -0.5],
          [3, 1],
          [1, 1],
        ],
      ],
    })

    const geometry = generateSlabGeometry(slab)

    expect((geometry.index?.count ?? 0) / 3).toBeGreaterThan(0)
    expect(hasVertexAt(geometry, 1, 1)).toBe(true)
    expect(hasVertexAt(geometry, 3, 1)).toBe(true)
  })

  test('renders a boundary-overlapping hole as an open indentation on recessed slabs', () => {
    const slab = SlabNode.parse({
      elevation: -0.2,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [
        [
          [1, -0.5],
          [3, -0.5],
          [3, 1],
          [1, 1],
        ],
      ],
    })

    const geometry = generateSlabGeometry(slab)

    expect((geometry.index?.count ?? 0) / 3).toBeGreaterThan(0)
    expect(hasVertexAt(geometry, 1, 1)).toBe(true)
    expect(hasVertexAt(geometry, 3, 1)).toBe(true)
  })
})
