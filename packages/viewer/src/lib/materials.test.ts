// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { MaterialProperties, type MaterialSchema } from '@pascal-app/core'
import { MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { materialCastsShadow } from '../index'
import {
  createMaterial,
  getTextureKey,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  resolveTextureRepeat,
} from './materials'

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

describe('material shadow policy', () => {
  test('library glass does not cast in either shading mode, independent of its name', () => {
    for (const shading of ['solid', 'rendered'] as const) {
      const glass = resolveMaterialRef('library:preset-glass', undefined, shading)!
      expect(glass.name).not.toBe('glass')
      expect(materialCastsShadow(glass)).toBe(false)
      const opaque = resolveSlotDefaultMaterial('#cccccc', shading)
      expect(materialCastsShadow(opaque)).toBe(true)
      expect(materialCastsShadow([opaque, glass])).toBe(false)
    }
  })

  test('transmission and glass opacity suppress casting, while tinted and opaque materials cast', () => {
    const transmitting = new MeshPhysicalMaterial({ transmission: 0.9 })
    const transparent = new MeshStandardMaterial({ transparent: true, opacity: 0.3 })
    const tinted = new MeshStandardMaterial({ transparent: true, opacity: 0.8 })
    const opaque = new MeshStandardMaterial()
    opaque.name = 'glass'
    expect(materialCastsShadow(transmitting)).toBe(false)
    expect(materialCastsShadow(transparent)).toBe(false)
    expect(materialCastsShadow(tinted)).toBe(true)
    expect(materialCastsShadow(opaque)).toBe(true)
  })
})

describe('plain colour material refs', () => {
  test('a #rrggbb slot value paints that colour, as material.properties.color does', () => {
    const material = resolveMaterialRef(
      '#2F5585',
      undefined,
      'rendered',
    ) as MeshStandardNodeMaterial
    expect(material).toBeInstanceOf(MeshStandardNodeMaterial)
    expect(material.color.getHexString()).toBe('2f5585')
    expect(material).toBe(
      createMaterial({ properties: MaterialProperties.parse({ color: '#2f5585' }) }, 'rendered'),
    )
  })
})
