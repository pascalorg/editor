import { describe, expect, mock, test } from 'bun:test'
import { SlabNode } from '@pascal-app/core'
import { BufferGeometry, MeshStandardMaterial } from 'three'

mock.module('@pascal-app/viewer', () => ({
  applyMaterialPresetToMaterials: () => {},
  createMaterial: () => new MeshStandardMaterial(),
  DEFAULT_SLAB_MATERIAL: new MeshStandardMaterial({ color: 0xe5e5e5 }),
  generateSlabGeometry: () => new BufferGeometry(),
}))

const { buildSlabGeometry } = await import('../geometry')

describe('buildSlabGeometry', () => {
  test('lowers recessed slab geometry so negative elevation becomes a sunken floor', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      elevation: -1,
    })

    const group = buildSlabGeometry(slab)
    const mesh = group.children[0]

    expect(mesh?.position.y).toBe(-1)
  })

  test('keeps raised and ground slabs anchored at level floor', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      elevation: 0.15,
    })

    const group = buildSlabGeometry(slab)
    const mesh = group.children[0]

    expect(mesh?.position.y).toBe(0)
  })
})
