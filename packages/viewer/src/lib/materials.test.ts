// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import type { MaterialSchema } from '@pascal-app/core'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { getTextureKey, resolveSlotDefaultMaterial, resolveTextureRepeat } from './materials'

function materialWithRepeat(repeat: unknown): MaterialSchema {
  return {
    texture: {
      url: 'https://example.com/texture.png',
      repeat,
    },
  } as unknown as MaterialSchema
}

describe('legacy texture repeat values', () => {
  test('normalizes tuple, scalar, and Vector2-shaped repeats', () => {
    expect(resolveTextureRepeat([2, 3], undefined)).toEqual([2, 3])
    expect(resolveTextureRepeat(2, undefined)).toEqual([2, 2])
    expect(resolveTextureRepeat({ x: 2, y: 3 }, undefined)).toEqual([2, 3])
  })

  test('falls back to scale for malformed repeats', () => {
    expect(resolveTextureRepeat({ width: 2 }, 4)).toEqual([4, 4])
  })

  test('keeps distinct Vector2-shaped repeats in distinct cache entries', () => {
    expect(getTextureKey(materialWithRepeat({ x: 2, y: 3 }))).not.toBe(
      getTextureKey(materialWithRepeat({ x: 4, y: 5 })),
    )
  })
})

describe('shared flat slot defaults', () => {
  test('interns colors by case, roughness, and shading with cache ownership', () => {
    const rendered = resolveSlotDefaultMaterial('#AbCdEf', 'rendered', 0.75)
    expect(rendered).toBe(resolveSlotDefaultMaterial('#abcdef', 'rendered', 0.75))
    expect(rendered.userData.__pascalCachedMaterial).toBe(true)
    expect(rendered).toBeInstanceOf(MeshStandardNodeMaterial)
    expect((rendered as MeshStandardNodeMaterial).color.getHexString()).toBe('abcdef')
    expect((rendered as MeshStandardNodeMaterial).roughness).toBe(0.75)
    expect((rendered as MeshStandardNodeMaterial).metalness).toBe(0)
    expect(rendered).not.toBe(resolveSlotDefaultMaterial('#abcdef', 'rendered', 0.9))
    const solid = resolveSlotDefaultMaterial('#ABCDEF', 'solid', 0.75)
    expect(solid).not.toBe(rendered)
    expect(solid).toBeInstanceOf(MeshLambertNodeMaterial)
    expect(solid).toBe(resolveSlotDefaultMaterial('#abcdef', 'solid', 0.75))
    expect(solid.userData.__pascalCachedMaterial).toBe(true)
  })
})
