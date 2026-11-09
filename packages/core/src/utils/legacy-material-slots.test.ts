import { describe, expect, test } from 'bun:test'
import { legacySpecToMaterialRef, migrateStructuralMaterialSlots } from './legacy-material-slots'

describe('legacy material slots', () => {
  test('an inline finish mints one content-derived scene material, the same on every load', () => {
    const first = {}
    const again = {}
    const ref = legacySpecToMaterialRef({ material: { preset: 'white' } }, first)
    expect(ref).toMatch(/^scene:mat_[0-9a-z]{16}$/)
    expect(legacySpecToMaterialRef({ material: { preset: 'white' } }, first)).toBe(ref)
    expect(Object.keys(first)).toHaveLength(1)
    expect(legacySpecToMaterialRef({ material: { preset: 'white' } }, again)).toBe(ref)
    expect(legacySpecToMaterialRef({ material: { preset: 'wood' } }, again)).not.toBe(ref)
    expect(legacySpecToMaterialRef({ materialPreset: 'library:preset-sage' }, again)).toBe(
      'library:preset-sage',
    )
  })

  test('walls, slabs and ceilings move their legacy finish onto slots; other kinds are untouched', () => {
    const nodes = {
      wall_a: { id: 'wall_a', type: 'wall', interiorMaterialPreset: 'library:preset-sage' },
      slab_a: { id: 'slab_a', type: 'slab', material: { preset: 'wood' } },
      fence_a: { id: 'fence_a', type: 'fence', material: { preset: 'wood' } },
      wall_b: { id: 'wall_b', type: 'wall', slots: { a: 'library:preset-navy' } },
    }
    const result = migrateStructuralMaterialSlots(nodes)
    expect(result.changed).toBe(true)
    expect(result.nodes.wall_a).toMatchObject({ slots: { interior: 'library:preset-sage' } })
    const wood = (result.nodes.slab_a as { slots: { surface: string } }).slots.surface
    expect(Object.keys(result.materials)).toEqual([wood.slice('scene:'.length)])
    expect(result.nodes.fence_a).toBe(nodes.fence_a)
    expect(result.nodes.wall_b).toBe(nodes.wall_b)
    expect(migrateStructuralMaterialSlots({ wall_b: nodes.wall_b }).changed).toBe(false)
  })
})
