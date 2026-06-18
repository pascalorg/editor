import { describe, expect, test } from 'bun:test'
import {
  executableFamilyForLayoutFamily,
  FAMILY_DEFINITIONS,
  getLayoutFamilyDefinition,
  LAYOUT_FAMILY_DEFINITIONS,
  normalizeLayoutFamilyId,
} from './family-registry'

describe('layout family registry', () => {
  test('maps legacy executable families to stable layout families', () => {
    expect(normalizeLayoutFamilyId('pump')).toBe('rotating_machine_layout')
    expect(normalizeLayoutFamilyId('compressor')).toBe('rotating_machine_layout')
    expect(normalizeLayoutFamilyId('tank')).toBe('vessel_layout')
    expect(normalizeLayoutFamilyId('reactor')).toBe('vessel_layout')
    expect(normalizeLayoutFamilyId('machine_tool')).toBe('box_enclosure_layout')
    expect(normalizeLayoutFamilyId('electrical')).toBe('box_enclosure_layout')
    expect(normalizeLayoutFamilyId('conveyor')).toBe('linear_transport_layout')
  })

  test('keeps every advertised executable family covered by a layout family', () => {
    for (const family of FAMILY_DEFINITIONS) {
      expect(
        normalizeLayoutFamilyId(family.id),
        `family ${family.id} should resolve to a layout family`,
      ).toBeDefined()
    }
  })

  test('resolves layout families back to their default executable families', () => {
    expect(executableFamilyForLayoutFamily('rotating_machine_layout')).toBe('pump')
    expect(executableFamilyForLayoutFamily('box_enclosure_layout', 'electrical')).toBe('electrical')
    expect(getLayoutFamilyDefinition('enclosed machine')?.id).toBe('box_enclosure_layout')
    expect(LAYOUT_FAMILY_DEFINITIONS.length).toBeGreaterThanOrEqual(6)
  })
})
