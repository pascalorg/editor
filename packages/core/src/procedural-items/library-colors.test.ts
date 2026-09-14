import { expect, test } from 'bun:test'
import { MATERIAL_CATALOG, type MaterialCatalogItem } from '../material-library'
import { shelfRecipe } from './fixtures'
import { nearestLibraryColorRef, snapProceduralSlotsToLibrary } from './library-colors'
import { proceduralSlotColor } from './materials'
import { ProceduralItemNode } from './node'

const softWhite = MATERIAL_CATALOG.find((entry) => entry.id === 'preset-softwhite')!

test('glass finish selects the generic preset while explicit picks and recipe hex survive', () => {
  const recipe = structuredClone(shelfRecipe)
  recipe.slots[0]!.finish = 'glass'
  for (const pick of [
    undefined,
    'scene:mtl_painted',
    'library:preset-white',
    recipe.slots[0]!.color,
  ]) {
    const node = ProceduralItemNode.parse({
      recipe,
      slots: pick ? { frame: pick } : {},
    })
    const before = structuredClone(node)
    expect(snapProceduralSlotsToLibrary(node).frame).toBe(pick ?? 'library:preset-glass')
    expect(node).toEqual(before)
  }
})

test('glass glyph uses the preset color and Authored uses the recipe hex', () => {
  const authored = shelfRecipe.slots[0]!.color
  expect(proceduralSlotColor('library:preset-glass', authored, {})).toBe('#87ceeb')
  expect(proceduralSlotColor(undefined, authored, {})).toBe(authored)
  expect(proceduralSlotColor(authored, authored, {})).toBe(authored)
})

test('exact matches ignore hex casing and report zero CIE76 distance', () => {
  expect(nearestLibraryColorRef('#EBE7DF')).toEqual({
    ref: 'library:preset-softwhite',
    color: '#ebe7df',
    name: 'Soft White',
    distance: 0,
  })
})

test('a nearby warm white matches Soft White', () => {
  const match = nearestLibraryColorRef('#eae6de')!
  expect(match.ref).toBe('library:preset-softwhite')
  expect(match.distance).toBeGreaterThan(0)
  expect(match.distance).toBeLessThan(1)
})

test('textured entries and non-color categories cannot win even with an exact color', () => {
  const wood = MATERIAL_CATALOG.find((entry) => entry.category === 'wood')!
  const textured = (maps: MaterialCatalogItem['preset']['maps']): MaterialCatalogItem => ({
    ...softWhite,
    id: 'textured',
    preset: { ...softWhite.preset, maps },
  })
  const excluded = [
    { ...wood, preset: { ...wood.preset, mapProperties: softWhite.preset.mapProperties } },
    { ...softWhite, category: 'wood' as const },
    textured({ albedoMap: '/albedo.png' }),
    textured({ normalMap: '/normal.png' }),
    textured({ roughnessMap: '/roughness.png' }),
  ]
  expect(nearestLibraryColorRef('#ebe7df', excluded)).toBeNull()
  expect(nearestLibraryColorRef('#ebe7df', [...excluded, softWhite])?.ref).toBe(
    'library:preset-softwhite',
  )
})

test('ties follow catalog order', () => {
  const first = { ...softWhite, id: 'first' }
  expect(nearestLibraryColorRef('#ebe7df', [first, softWhite])?.ref).toBe('library:first')
  expect(nearestLibraryColorRef('#ebe7df', [softWhite, first])?.ref).toBe(
    'library:preset-softwhite',
  )
})

test('empty catalogs and invalid hex inputs have no match', () => {
  expect(nearestLibraryColorRef('#ebe7df', [])).toBeNull()
  expect(nearestLibraryColorRef('not a hex')).toBeNull()
  expect(nearestLibraryColorRef('#gggggg')).toBeNull()
})

test('snapping fills every unpainted slot without changing the node or recipe colors', () => {
  const node = ProceduralItemNode.parse({ recipe: shelfRecipe })
  const before = structuredClone(node)
  const slots = snapProceduralSlotsToLibrary(node, { keepOverrides: true })
  expect(Object.keys(slots)).toEqual(node.recipe.slots.map((slot) => slot.id))
  for (const slot of node.recipe.slots) {
    expect(slots[slot.id]).toBe(nearestLibraryColorRef(slot.color)!.ref)
  }
  expect(slots).not.toBe(node.slots)
  expect(node).toEqual(before)
})

test('scene, library, and hex overrides are preserved while other slots are snapped', () => {
  for (const ref of ['scene:mtl_painted', 'library:preset-white', '#AbCdEf']) {
    const node = ProceduralItemNode.parse({ recipe: shelfRecipe, slots: { frame: ref } })
    const before = structuredClone(node)
    const slots = snapProceduralSlotsToLibrary(node, { keepOverrides: true })
    expect(slots.frame).toBe(ref)
    expect(slots.shelves).toStartWith('library:')
    expect(slots.back).toStartWith('library:')
    expect(node).toEqual(before)
  }
})
