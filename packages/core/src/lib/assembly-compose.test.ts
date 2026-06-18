import { describe, expect, test } from 'bun:test'
import { composeAssemblyPrimitives } from './assembly-compose'
import { FAMILY_DEFINITIONS } from './family-registry'

describe('assembly composition routing', () => {
  test('composes every canonical registry family through assembly routing', () => {
    for (const family of FAMILY_DEFINITIONS) {
      const shapes = composeAssemblyPrimitives({ family: family.id })

      expect(
        shapes.length,
        `family ${family.id} should compose at least one shape`,
      ).toBeGreaterThan(0)
    }
  })

  test('does not silently return empty arrays for registry-only assembly families', () => {
    const registryOnlyFamilies = [
      'aircraft',
      'bicycle',
      'desk',
      'kiosk',
      'valve',
      'mixer',
      'pipe_system',
      'heat_exchanger',
      'fluid_machine',
      'forming_machine',
      'material_handling',
      'process_equipment',
    ] as const

    for (const family of registryOnlyFamilies) {
      const shapes = composeAssemblyPrimitives({ family })

      expect(
        shapes.length,
        `family ${family} should not route to an empty fallback`,
      ).toBeGreaterThan(0)
    }
  })
})
