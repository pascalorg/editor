import { describe, expect, test } from 'bun:test'
import { getEffectiveWallSurfaceMaterial, type WallNode } from './wall'

describe('wall surface material resolution', () => {
  test('prefers a configured custom surface material over a stale surface preset', () => {
    const material = {
      preset: 'custom',
      properties: {
        color: '#d4af37',
        roughness: 0.5,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
    } satisfies NonNullable<WallNode['interiorMaterial']>

    const wall = {
      type: 'wall',
      interiorMaterial: material,
      interiorMaterialPreset: 'library:wood-oak',
    } satisfies Partial<WallNode>

    expect(getEffectiveWallSurfaceMaterial(wall, 'interior')).toEqual({
      material,
    })
  })
})
