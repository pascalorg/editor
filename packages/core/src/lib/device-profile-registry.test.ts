import { describe, expect, test } from 'bun:test'
import {
  applyDeviceProfileToPartInput,
  buildDraftDeviceProfile,
  DEVICE_PROFILE_DEFINITIONS,
  evaluateDeviceProfileQuality,
  getDeviceProfileDefinition,
  inferDeviceProfileDefinition,
  mergeDeviceProfiles,
  normalizeDeviceProfileInput,
  resolveEditableSchemaForProfile,
  validateDeviceProfileDefinition,
  validateDeviceProfileForExecution,
  validateDeviceProfileSchema,
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

  test('respects explicit robot arm axis count when selecting profiles', () => {
    const baseRobotProfile = {
      ...getDeviceProfileDefinition('robot_welding_cell')!,
      source: 'imported_pack' as const,
      family: 'robot_arm',
      layoutFamily: 'robot_workcell_layout' as const,
      aliases: ['industrial robot arm', 'robot arm'],
      layoutHints: {
        robotArmDefaults: {
          scope: 'arm_only',
          includeWorkcell: false,
        },
      },
    }
    const sixAxisProfile = {
      ...baseRobotProfile,
      id: 'robotics.six_axis_industrial_robot_arm',
      name: 'Six-axis industrial robot arm',
      layoutHints: {
        robotArmDefaults: {
          axisCount: 6,
          scope: 'arm_only',
          includeWorkcell: false,
        },
      },
    }
    const fourAxisProfile = {
      ...baseRobotProfile,
      id: 'robotics.four_axis_industrial_robot_arm',
      name: 'Four-axis industrial robot arm',
      aliases: ['four-axis industrial robot arm', '4-axis robot arm', 'robot arm'],
      layoutHints: {
        robotArmDefaults: {
          axisCount: 4,
          scope: 'arm_only',
          includeWorkcell: false,
        },
      },
    }

    expect(
      inferDeviceProfileDefinition({ prompt: 'create a four-axis industrial robot arm' }, [
        sixAxisProfile,
        fourAxisProfile,
      ])?.id,
    ).toBe('robotics.four_axis_industrial_robot_arm')
    expect(
      inferDeviceProfileDefinition({ prompt: 'create a four-axis industrial robot arm' }, [
        sixAxisProfile,
      ]),
    ).toBeUndefined()
    expect(
      inferDeviceProfileDefinition({ prompt: 'create a six-axis industrial robot arm' }, [
        sixAxisProfile,
        fourAxisProfile,
      ])?.id,
    ).toBe('robotics.six_axis_industrial_robot_arm')
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

  test('infers default editable schemas for common industrial profile archetypes', () => {
    expect(
      resolveEditableSchemaForProfile(getDeviceProfileDefinition('packaging_machine')!)?.id,
    ).toBe('enclosure.common')
    expect(
      resolveEditableSchemaForProfile(getDeviceProfileDefinition('screw_compressor')!)?.id,
    ).toBe('rotary_equipment.common')
    expect(
      resolveEditableSchemaForProfile(getDeviceProfileDefinition('vertical_storage_tank')!)?.id,
    ).toBe('vessel.common')
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

  test('records when an imported resource-pack profile overrides a builtin fallback', () => {
    const builtin = getDeviceProfileDefinition('screw_compressor')
    expect(builtin).toBeDefined()
    const imported = {
      ...builtin!,
      source: 'imported_pack' as const,
      sourcePack: {
        id: 'industry.robotics.basic',
        version: '1.0.0',
      },
      name: 'Pack Screw Compressor',
    }

    const merged = mergeDeviceProfiles([[imported], [builtin!]])
    const winner = merged.profiles.find((profile) => profile.id === 'screw_compressor')
    const applied = applyDeviceProfileToPartInput(winner!, {})

    expect(winner).toMatchObject({
      name: 'Pack Screw Compressor',
      source: 'imported_pack',
      sourcePack: { id: 'industry.robotics.basic', version: '1.0.0' },
    })
    expect(winner?.overrides?.[0]).toMatchObject({
      id: 'screw_compressor',
      source: 'builtin',
    })
    expect(applied).toMatchObject({
      overrodeBuiltin: true,
      profilePackId: 'industry.robotics.basic',
    })
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

  test('scores required roles through profile role aliases', () => {
    const profile = {
      ...getDeviceProfileDefinition('screw_compressor')!,
      id: 'cement.rotary_kiln.test',
      name: 'Rotary kiln',
      family: 'tank',
      layoutFamily: 'vessel_layout' as const,
      primarySemanticRole: 'kiln_shell',
      parts: [
        { kind: 'cylindrical_tank', semanticRole: 'kiln_shell', required: true },
        { kind: 'skid_base', semanticRole: 'kiln_support_base', required: true },
      ],
      roleAliases: {
        kiln_support_base: ['support_pier', 'support_base'],
      },
    }

    const quality = evaluateDeviceProfileQuality(profile, [
      { semanticRole: 'kiln_shell', sourcePartKind: 'cylindrical_tank', length: 12, width: 2.4 },
      { semanticRole: 'support_pier', sourcePartKind: 'skid_base', length: 2, width: 1 },
    ])

    expect(quality.metrics.requiredCoverage).toBe(1)
    expect(quality.issues).toHaveLength(0)
  })

  test('normalizes resource-pack generation metadata and applies quality rules', () => {
    const profile = {
      ...getDeviceProfileDefinition('screw_compressor')!,
      id: 'industry.robot.test_arm',
      name: 'Pack robot arm',
      industry: 'robotics',
      layoutTemplate: 'articulated_robot.six_axis',
      partPresets: {
        shoulder_joint: 'robot_joint.large',
      },
      qualityRules: {
        requiredRoles: ['tool_flange'],
        forbiddenRoles: ['work_table'],
        shapeCount: { min: 4, max: 16 },
        dimensionExpectations: {
          lengthToDiameterRatio: { min: 1.5, max: 8 },
        },
      },
      detailBudget: {
        detailLevel: 'low' as const,
        maxShapes: 16,
        parts: {
          upper_arm: { detailLevel: 'low' as const, count: 2 },
          generic_panel: { count: 1 },
        },
      },
      source: 'imported_pack' as const,
      sourcePack: {
        id: 'industry.robotics.basic',
        version: '1.0.0',
        industry: 'robotics',
      },
      parts: [
        { kind: 'generic_base', semanticRole: 'robot_base', required: true },
        { kind: 'generic_body', semanticRole: 'upper_arm', required: true },
        { kind: 'generic_panel', semanticRole: 'tool_flange' },
      ],
      primarySemanticRole: 'robot_base',
    }

    const normalized = applyDeviceProfileToPartInput(profile, { prompt: 'make robot arm' })
    const quality = evaluateDeviceProfileQuality(profile, [
      {
        semanticRole: 'robot_base',
        sourcePartKind: 'generic_base',
        length: 0.8,
        width: 0.8,
        height: 0.8,
      },
      {
        semanticRole: 'upper_arm',
        sourcePartKind: 'generic_body',
        length: 1.8,
        width: 0.35,
        height: 0.35,
      },
      {
        semanticRole: 'tool_flange',
        sourcePartKind: 'generic_panel',
        length: 0.25,
        width: 0.2,
        height: 0.2,
      },
      {
        semanticRole: 'wrist_joint',
        sourcePartKind: 'generic_panel',
        length: 0.2,
        width: 0.2,
        height: 0.2,
      },
    ])

    expect(normalized).toMatchObject({
      layoutTemplate: 'articulated_robot.six_axis',
      profileIndustry: 'robotics',
      profilePackId: 'industry.robotics.basic',
      partPresets: { shoulder_joint: 'robot_joint.large' },
      qualityRules: profile.qualityRules,
      detailBudget: profile.detailBudget,
    })
    expect(
      (normalized.parts as Record<string, unknown>[]).find(
        (part) => part.semanticRole === 'upper_arm',
      ),
    ).toMatchObject({
      detailLevel: 'low',
      count: 2,
    })
    expect(quality.metrics.requiredCoverage).toBe(1)
    expect(quality.metrics.ratioExpectationScore).toBeGreaterThan(0)
    expect(quality.issues).toHaveLength(0)
  })

  test('normalizes JSON detail budgets and uses them as shape budget quality contracts', () => {
    const profile = normalizeDeviceProfileInput({
      id: 'test_plate_stack',
      name: 'Test plate stack',
      aliases: ['test plate stack'],
      family: 'generic',
      archetypeFamily: 'thermal_equipment',
      parts: [
        { kind: 'generic_body', semanticRole: 'plate_stack', required: true },
        { kind: 'generic_panel', semanticRole: 'heat_transfer_plate', required: true },
      ],
      primarySemanticRole: 'plate_stack',
      detailBudget: {
        detailLevel: 'low',
        maxShapes: 2,
        parts: {
          heat_transfer_plate: { count: 1, detailLevel: 'low' },
        },
      },
    })
    const normalized = applyDeviceProfileToPartInput(profile, {})
    const quality = evaluateDeviceProfileQuality(profile, [
      { semanticRole: 'plate_stack', sourcePartKind: 'generic_body' },
      { semanticRole: 'heat_transfer_plate', sourcePartKind: 'generic_panel' },
      { semanticRole: 'extra_detail', sourcePartKind: 'generic_panel' },
    ])

    expect(validateDeviceProfileSchema(profile).ok).toBe(true)
    expect((normalized.parts as Record<string, unknown>[])[0]).toMatchObject({
      detailLevel: 'low',
    })
    expect((normalized.parts as Record<string, unknown>[])[1]).toMatchObject({
      detailLevel: 'low',
      count: 1,
    })
    expect(quality.issues).toContain('Shape count 3 exceeds profile maximum 2.')
  })
})
