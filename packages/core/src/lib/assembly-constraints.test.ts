import { describe, expect, test } from 'bun:test'
import {
  extractUserGeometryConstraints,
  inferAssemblyFamily,
  validateAssemblyConstraints,
} from './assembly-constraints'
import { FAMILY_DEFINITIONS, getFamilyDefinition, normalizeFamilyId } from './family-registry'
import { composePartPrimitives } from './part-compose'

describe('assembly family registry integration', () => {
  test('uses the family registry as the canonical assembly family source', () => {
    expect(normalizeFamilyId('cnc machine')).toBe('machine_tool')
    expect(normalizeFamilyId('industrial robot')).toBe('robot_arm')
    expect(normalizeFamilyId('condenser unit')).toBe('outdoor_ac')

    expect(inferAssemblyFamily('build a cnc machining center')).toBe('machine_tool')
    expect(inferAssemblyFamily('build a six axis industrial robot')).toBe('robot_arm')
    expect(inferAssemblyFamily('build a clinker cooler')).toBe('grate_cooler')
  })

  test('infers registry aliases as tokens instead of arbitrary substrings', () => {
    expect(inferAssemblyFamily('build a FANUC M-710 industrial arm')).toBe('robot_arm')
    expect(inferAssemblyFamily('build an industrial fan with a guard')).toBe('fan')
    expect(inferAssemblyFamily('build a fantasy display object')).toBe('unknown')
  })

  test('does not let generic single-character Chinese aliases steal compound aliases', () => {
    expect(inferAssemblyFamily('生成一个搅拌罐')).toBe('reactor')
    expect(inferAssemblyFamily('生成一个罐')).toBe('tank')
  })

  test('keeps registry families available to assembly constraints', () => {
    const expected = [
      'fan',
      'outdoor_ac',
      'distillation_tower',
      'grate_cooler',
      'valve',
      'robot_arm',
      'machine_tool',
      'tank',
      'compressor',
      'heat_exchanger',
      'bicycle',
      'mixer',
      'forming_machine',
      'material_handling',
      'fluid_machine',
      'process_equipment',
    ]

    for (const family of expected) {
      expect(getFamilyDefinition(family)?.id).toBe(family)
    }
  })

  test('advertises only part-compose compatible family parts', () => {
    const advertisedKinds = new Set(
      FAMILY_DEFINITIONS.flatMap((family) => [...family.requiredParts, ...family.optionalParts]),
    )

    for (const kind of advertisedKinds) {
      const shapes = composePartPrimitives({
        registryPartPlan: true,
        autoComplete: false,
        parts: [{ kind }],
      })

      expect(shapes.length, `family registry part "${kind}" should compose`).toBeGreaterThan(0)
    }
  })

  test('keeps primary shape metadata for every registry family', () => {
    for (const family of FAMILY_DEFINITIONS) {
      expect(
        family.primarySemanticRoles.length,
        `family ${family.id} must declare primarySemanticRoles`,
      ).toBeGreaterThan(0)
    }
  })

  test('validates pump and fan primary length constraints without regex fallback', () => {
    const length = { value: 1.2, source: 'args' as const, priority: 'hard' as const }

    for (const [family, semanticRole] of [
      ['pump', 'volute_casing'],
      ['fan', 'motor_housing'],
    ] as const) {
      const result = validateAssemblyConstraints(
        [{ kind: 'box', semanticRole, length: 0.4, width: 0.2, height: 0.2 }],
        { family, length },
      )

      expect(result.ok, `${family} should fail mismatched primary length`).toBe(false)
      expect(result.issues).toContain(
        'Hard constraint failed: expected primary length 1.2m, got 0.4m.',
      )
    }
  })

  test('validates industrial assembly length from the largest primary part', () => {
    const result = validateAssemblyConstraints(
      [
        { kind: 'box', semanticRole: 'volute_casing', length: 0.43, width: 0.2, height: 0.2 },
        { kind: 'box', sourcePartKind: 'skid_base', length: 2.6, width: 1.1, height: 0.18 },
      ],
      { family: 'pump', length: { value: 2.6, source: 'prompt', priority: 'hard' } },
    )

    expect(result.ok).toBe(true)
  })

  test('does not hard-fail industrial assemblies on prompt-derived part colors', () => {
    const result = validateAssemblyConstraints(
      [
        {
          kind: 'box',
          semanticRole: 'conveyor_frame',
          length: 4.2,
          width: 0.85,
          height: 0.75,
          material: { properties: { color: '#94a3b8' } },
        },
      ],
      {
        family: 'conveyor',
        length: { value: 4.2, source: 'prompt', priority: 'hard' },
        primaryColor: { value: '#111827', source: 'prompt', priority: 'hard' },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.issues).toContain(
      'Hard constraint failed: expected primary color #111827, got #94a3b8.',
    )

    const extractedConstraints = extractUserGeometryConstraints(
      'black belt conveyor with a yellow warning label, length 4.2m',
      { family: 'conveyor' },
    )
    const extracted = validateAssemblyConstraints(
      [
        {
          kind: 'box',
          semanticRole: 'conveyor_frame',
          length: 4.2,
          width: 0.85,
          height: 0.75,
          material: { properties: { color: '#94a3b8' } },
        },
      ],
      extractedConstraints,
    )

    expect(extractedConstraints.primaryColor).toBeUndefined()
    expect(extracted.ok).toBe(true)
  })
})
