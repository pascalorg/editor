// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import type { MaterialSchema } from '@pascal-app/core'
import { getTextureKey, resolveTextureRepeat } from './materials'

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
