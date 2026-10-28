import { describe, expect, test } from 'bun:test'
import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialSwatch,
  getMaterialsForCategory,
  getSceneMaterialIdFromRef,
} from './material-library'

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
      imageUrl: navy.preset.maps.albedoMap!,
      tinted: true,
    })
    const batten = getMaterialSwatch(getCatalogMaterialById('siding-batten-olive')!)
    expect(batten.imageUrl).toContain('batten')
  })

  test('a thumbnail shows as is, and a flat colour stays a colour', () => {
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
