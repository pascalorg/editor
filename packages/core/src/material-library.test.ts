import { describe, expect, test } from 'bun:test'
import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialSwatch,
  getMaterialsForCategory,
  getSceneMaterialIdFromRef,
} from './index'

describe('material references', () => {
  test('rejects malformed runtime values instead of calling string methods', () => {
    const malformedRefs: unknown[] = [42, true, {}, []]

    for (const ref of malformedRefs) {
      expect(getLibraryMaterialIdFromRef(ref as string)).toBeNull()
      expect(getSceneMaterialIdFromRef(ref as string)).toBeNull()
    }
  })
})

describe('siding', () => {
  test('shares complete metre-scale lap and batten profiles across the 18 painted finishes', () => {
    const siding = getMaterialsForCategory('siding')
    expect(siding).toHaveLength(18)
    for (const item of siding) {
      const profile = item.id.includes('batten') || item.id.includes('vertical') ? 'batten' : 'lap'
      expect(item.preset.maps).toEqual({
        albedoMap: `/material/siding/${profile}_basecolor_512.ktx2`,
        normalMap: `/material/siding/${profile}_normal_512.ktx2`,
        roughnessMap: `/material/siding/${profile}_roughness_512.ktx2`,
        aoMap: `/material/siding/${profile}_ao_512.ktx2`,
      })
      expect(item.preset.mapProperties.repeatX).toBe(1)
      expect(item.preset.mapProperties.repeatY).toBe(1)
      expect(item.preset.mapProperties.flipY).toBe(false)
      expect(getMaterialSwatch(item).imageUrl).toBe(item.previewThumbnailUrl!)
      expect(getMaterialSwatch(item).tinted).toBe(true)
    }
  })

  test('has its own category, apart from wood, under the ids scenes already reference', () => {
    const siding = getMaterialsForCategory('siding').map((item) => item.id)
    for (const id of ['siding-lap-white', 'siding-lap-cedar', 'siding-batten-charcoal']) {
      expect(siding).toContain(id)
      expect(getCatalogMaterialById(id)?.category).toBe('siding')
    }
    expect(siding).toContain('siding-vinyl-white')
    expect(getMaterialsForCategory('wood').some((item) => item.id.startsWith('siding-'))).toBe(
      false,
    )
  })

  test('a siding swatch is its profile texture tinted by its colour, not a flat chip', () => {
    const navy = getCatalogMaterialById('siding-lap-navy')!
    expect(getMaterialSwatch(navy)).toEqual({
      color: navy.preset.mapProperties.color,
      imageUrl: navy.previewThumbnailUrl!,
      tinted: true,
    })
    const batten = getMaterialSwatch(getCatalogMaterialById('siding-batten-olive')!)
    expect(batten.imageUrl).toContain('batten')
  })

  test('a thumbnail multiplies the material tint instead of its representative preview colour', () => {
    const navy = getCatalogMaterialById('siding-lap-navy')!
    const item = {
      ...navy,
      previewThumbnailUrl: '/material/siding/lap_thumb.webp',
      previewColor: '#eeeeee',
    }
    expect(getMaterialSwatch(item)).toEqual({
      color: navy.preset.mapProperties.color,
      imageUrl: item.previewThumbnailUrl,
      tinted: true,
    })
  })

  test('a white-tinted thumbnail shows as is, and a flat colour stays a colour', () => {
    const wood = getCatalogMaterialById('wood-finewood27')!
    expect(getMaterialSwatch(wood)).toEqual({
      color: wood.previewColor!,
      imageUrl: wood.previewThumbnailUrl!,
      tinted: false,
    })
    const white = getMaterialSwatch(getCatalogMaterialById('preset-white')!)
    expect(white.imageUrl).toBeNull()
  })
})
