// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { MaterialProperties, type MaterialSchema } from '@pascal-app/core'
import {
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
  createMaterial as createSceneMaterial,
  materialCastsShadow,
  resolveMaterialRef as resolveSceneMaterialRef,
} from '../index'
import {
  createMaterial,
  createMaterialFromPreset,
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

describe('native texture placement', () => {
  const placed = (offset: [number, number]): MaterialSchema => ({
    texture: {
      url: 'https://example.com/tile.png',
      repeat: [2, 2],
      offset,
      normalMap: 'https://example.com/tile-normal.png',
      normalScale: 0.5,
      bumpMap: 'https://example.com/tile-height.png',
    },
  })

  // TextureLoader creates an <img>; no request is made in this runtime.
  function withImageStub<T>(run: () => T): T {
    const previous = globalThis.document
    globalThis.document = {
      createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }),
    } as unknown as Document
    try {
      return run()
    } finally {
      globalThis.document = previous
    }
  }

  test('offset, normal and bump maps share the albedo placement; maps stay linear', () => {
    const material = withImageStub(() =>
      createMaterial(placed([0.25, 0.5]), 'rendered'),
    ) as MeshStandardNodeMaterial
    for (const map of [material.map, material.normalMap, material.bumpMap]) {
      expect(map?.offset.toArray()).toEqual([0.25, 0.5])
      expect(map?.repeat.toArray()).toEqual([2, 2])
    }
    expect(material.map?.colorSpace).toBe(SRGBColorSpace)
    expect(material.normalMap?.colorSpace).toBe(NoColorSpace)
    expect(material.bumpMap?.colorSpace).toBe(NoColorSpace)
    expect(material.normalScale.toArray()).toEqual([0.5, 0.5])
    expect(material.bumpScale).toBe(1)
  })

  test('a different offset is a different texture and material', () => {
    expect(getTextureKey(placed([0, 0]))).not.toBe(getTextureKey(placed([0.5, 0])))
    const [first, second] = withImageStub(() => [
      createMaterial(placed([0, 0]), 'rendered') as MeshStandardNodeMaterial,
      createMaterial(placed([0.5, 0]), 'rendered') as MeshStandardNodeMaterial,
    ])
    expect(first).not.toBe(second)
    expect(first.map).not.toBe(second.map)
    expect(second.map?.offset.toArray()).toEqual([0.5, 0])
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

describe('authored transparency', () => {
  test('a scene material keeps its opacity and reflection intensity independently of glass styling', () => {
    const properties = MaterialProperties.parse({
      color: '#789ca2',
      roughness: 0.14,
      opacity: 0.38,
      transparent: true,
    })
    const preset = createSceneMaterial({ preset: 'glass', properties }) as MeshStandardNodeMaterial
    const materials = {
      mat_authored: {
        id: 'mat_authored' as const,
        name: 'Authored glass',
        material: { preset: 'custom' as const, properties },
      },
    }
    const authored = resolveSceneMaterialRef(
      'scene:mat_authored',
      materials,
    ) as MeshStandardNodeMaterial
    expect(authored.opacity).toBe(0.38)
    expect(authored.opacityNode).toBeNull()
    expect(authored.envMapIntensity).toBe(1)
    expect(authored.color.getHexString()).toBe('789ca2')
    expect(authored.roughness).toBe(0.14)
    expect(materialCastsShadow(authored)).toBe(false)
    expect(preset.opacityNode).not.toBeNull()
    expect(preset.envMapIntensity).toBe(1.4)
    expect(preset).not.toBe(authored)
    expect(resolveSceneMaterialRef('scene:mat_authored', materials)).toBe(authored)
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

describe('catalog maps the asset CDN does not have yet', () => {
  test('a CDN miss loads the app’s own copy of the map', async () => {
    const requested: string[] = []
    const original = TextureLoader.prototype.loadAsync
    TextureLoader.prototype.loadAsync = ((url: string) => {
      requested.push(url)
      return url.startsWith('/')
        ? Promise.resolve(new Texture())
        : Promise.reject(new Error('404 on the CDN'))
    }) as typeof original
    try {
      const material = createMaterialFromPreset({
        maps: { albedoMap: '/material/test/cdn-miss_basecolor.webp' },
        mapProperties: { color: '#ffffff' },
      } as never) as MeshStandardNodeMaterial
      await Bun.sleep(0)
      await Promise.resolve()
      expect(requested).toEqual([
        expect.stringMatching(/^https?:\/\/.+\/material\/test\/cdn-miss_basecolor\.webp$/),
        '/material/test/cdn-miss_basecolor.webp',
      ])
      expect(material.map).toBeInstanceOf(Texture)
    } finally {
      TextureLoader.prototype.loadAsync = original
    }
  })
})
