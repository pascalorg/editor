import { describe, expect, test } from 'bun:test'
import {
  applyDeviceProfileToPartInput,
  buildDraftDeviceProfile,
  DEVICE_PROFILE_DEFINITIONS,
  evaluateDeviceProfileQuality,
  getDeviceProfileDefinition,
  inferDeviceProfileDefinition,
  mergeDeviceProfiles,
  validateDeviceProfileDefinition,
  validateDeviceProfileForExecution,
  validateDeviceProfiles,
} from './device-profile-registry'

describe('device profile registry', () => {
  test('infers long-tail equipment profiles without requiring one family per device', () => {
    expect(
      inferDeviceProfileDefinition({
        prompt: 'make a skid mounted screw compressor package with control cabinet',
      })?.id,
    ).toBe('screw_compressor')
    expect(
      inferDeviceProfileDefinition({
        name: 'robot palletizer cell',
      })?.id,
    ).toBe('palletizer_cell')
  })

  test('maps device profiles to reusable archetype families and starter parts', () => {
    const profile = getDeviceProfileDefinition('packaging_machine')

    expect(profile).toBeDefined()
    const input = applyDeviceProfileToPartInput(profile!, { name: 'automatic packaging machine' })

    expect(input).toMatchObject({
      family: 'machine_tool',
      deviceProfile: 'packaging_machine',
      archetypeFamily: 'enclosed_machine',
      layoutFamily: 'box_enclosure_layout',
      profileSource: 'builtin',
      primarySemanticRole: 'machine_enclosure',
      length: 2.6,
      width: 1,
      height: 1.6,
    })
    expect(Array.isArray(input.parts)).toBe(true)
    expect((input.parts as unknown[]).length).toBeGreaterThan(3)
  })

  test('keeps builtin profiles schema-valid and primary-role aware', () => {
    const validation = validateDeviceProfiles()

    expect(validation.ok, validation.issues.join('\n')).toBe(true)
    for (const profile of DEVICE_PROFILE_DEFINITIONS) {
      expect(profile.status).toBe('stable')
      expect(profile.source).toBe('builtin')
      expect(profile.primarySemanticRole.length).toBeGreaterThan(0)
      expect(profile.layoutFamily).toBeDefined()
    }
  })

  test('rejects profile drafts that reference unknown executable parts', () => {
    const profile = getDeviceProfileDefinition('screw_compressor')
    expect(profile).toBeDefined()

    const validation = validateDeviceProfileDefinition({
      ...profile!,
      id: 'draft.invalid_machine',
      status: 'draft',
      source: 'generated_candidate',
      parts: [{ kind: 'imaginary_part', semanticRole: 'imaginary_primary' }],
      primarySemanticRole: 'imaginary_primary',
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues.join('\n')).toContain('imaginary_part')
  })

  test('merges profile sources with predictable priority', () => {
    const builtin = getDeviceProfileDefinition('screw_compressor')
    expect(builtin).toBeDefined()
    const generated = {
      ...builtin!,
      source: 'generated_candidate' as const,
      name: 'Generated Screw',
    }
    const workspace = {
      ...builtin!,
      source: 'workspace' as const,
      name: 'Workspace Screw Compressor',
      aliases: ['workspace screw'],
    }

    const merged = mergeDeviceProfiles([[generated], [builtin!], [workspace]])

    expect(merged.profiles.find((profile) => profile.id === 'screw_compressor')?.name).toBe(
      'Workspace Screw Compressor',
    )
    expect(merged.warnings.join('\n')).toContain('overrides')
  })

  test('builds validated draft profiles for unknown industrial devices', () => {
    const freezeDryer = buildDraftDeviceProfile('generate a freeze dryer with sealed chamber')

    expect(freezeDryer.profile).toMatchObject({
      id: 'freeze_dryer_draft',
      family: 'generic',
      layoutFamily: 'generic_industrial_layout',
      status: 'runtime_draft',
      source: 'generated_candidate',
      primarySemanticRole: 'vacuum_chamber',
    })
    expect(freezeDryer.validation.ok, freezeDryer.validation.issues.join('\n')).toBe(true)

    const fallback = buildDraftDeviceProfile('generate a very unusual industrial machine')
    expect(fallback.profile).toMatchObject({
      family: 'generic',
      layoutFamily: 'generic_industrial_layout',
      primarySemanticRole: 'main_body',
    })
    expect(validateDeviceProfileForExecution(fallback.profile).ok).toBe(true)
  })

  test('scores generated shapes with profile-aware quality components', () => {
    const profile = getDeviceProfileDefinition('screw_compressor')
    expect(profile).toBeDefined()

    const quality = evaluateDeviceProfileQuality(profile!, [
      {
        semanticRole: 'compressor_casing',
        sourcePartKind: 'rounded_machine_body',
        position: [0.2, 0.45, 0],
        length: 1,
        width: 0.5,
        height: 0.5,
      },
      {
        semanticRole: 'drive_motor',
        sourcePartKind: 'ribbed_motor_body',
        position: [-0.5, 0.4, 0],
        length: 0.7,
        width: 0.4,
        height: 0.4,
      },
      {
        semanticRole: 'support_base',
        sourcePartKind: 'skid_base',
        position: [0, 0.05, 0],
        length: 1.8,
        width: 0.8,
        height: 0.1,
      },
    ])

    expect(quality.semanticScore).toBeGreaterThan(0.7)
    expect(quality.geometryScore).toBeGreaterThan(0.6)
    expect(quality.editabilityScore).toBe(1)
    expect(quality.overallScore).toBeGreaterThan(0.7)
  })
})
