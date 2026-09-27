import { describe, expect, test } from 'bun:test'
import ceilingFanJson from './__fixtures__/ceiling_fan.json'
import chandelierJson from './__fixtures__/chandelier_six_arms.json'
import condenserJson from './__fixtures__/trial-e1-condenser.json'
import airHandlerJson from './__fixtures__/trial-e2-air-handler.json'
import louverJson from './__fixtures__/trial-e5-louver.json'
import stairGuardJson from './__fixtures__/trial-e8-stair-guard.json'
import {
  DESIGN_EXAMPLE,
  DesignValidationSchema,
  describeDesignSchema,
  validateDesign,
} from './design'

// Trial fixtures: recipes of real /next elements from the asset-kernel trial, with the
// renderer's triangle and batch counts and the sweep results recorded there.
const louver = () => structuredClone(louverJson) as any

describe('describeDesignSchema', () => {
  test('is JSON Schema generated from RecipeSchema with a named recursive expression', () => {
    const { schema, rules, limits, example } = describeDesignSchema()
    const text = JSON.stringify(schema)
    expect(text.length).toBeLessThan(12_000)
    expect(text).not.toContain('__schema')
    expect(Object.keys(schema.$defs as object)).toEqual(['Expr'])
    expect(schema.required).toEqual([
      'version',
      'name',
      'description',
      'parameters',
      'slots',
      'parts',
      'constraints',
    ])
    expect(limits.shapes).toBe(256)
    expect(rules.length).toBeGreaterThan(10)
    expect(validateDesign(example)).toMatchObject({ valid: true, diagnostics: [] })
  })

  test('returns a fresh copy', () => {
    const first = describeDesignSchema()
    first.rules.length = 0
    ;(first.schema as { title?: string }).title = 'changed'
    const second = describeDesignSchema()
    expect(second.rules.length).toBeGreaterThan(10)
    expect(second.schema.title).toBe('Pascal design v1')
  })
})

describe('validateDesign on trial elements', () => {
  test.each([
    ['E1 condenser', condenserJson, 'floor', 4032, 5, 119, 25, [1.219, 1.076, 1.524]],
    ['E2 air handler', airHandlerJson, 'ceiling', 7200, 4, 30, 23, [2.125, 1.146, 2.21]],
    ['E5 louver', louverJson, 'wall', 252, 1, 21, 23, [0.634, 0.94, 0.076]],
  ] as const)('%s is valid and measured like the trial build', (_, json, datum, triangles, groups, shapes, cases, dimensions) => {
    const result = validateDesign(json)
    expect(DesignValidationSchema.parse(result)).toEqual(result)
    expect(result.valid).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.sweep).toEqual({ cases, failed: 0, failures: [] })
    const m = result.measurements!
    expect(m.triangles.actual).toBe(triangles)
    expect(m.drawGroups).toHaveLength(groups)
    expect(m.shapes).toBe(shapes)
    for (const [i, value] of m.bounds.dimensions.entries())
      expect(value).toBeCloseTo(dimensions[i]!, 3)
    expect(m.datum).toMatchObject({ kind: datum, gap: 0 })
    expect(m.datum.contact!.shapes).toBeGreaterThan(0)
    expect(m.components.count).toBe(1)
    expect(m.parts.reduce((sum, part) => sum + part.shapes, 0)).toBe(shapes)
  })

  test('per-part bounds and instances follow the parameters', () => {
    const at = (slat_count: number) =>
      validateDesign(louverJson, { parameters: { slat_count } }).measurements!.parts
    const slats = at(8).find((part) => part.id === 'slats')!
    expect(slats).toMatchObject({
      instances: 8,
      shapes: 8,
      triangles: 96,
      slots: ['frame'],
      motion: null,
    })
    const trim = at(8).find((part) => part.id === 'trim')!
    for (const k of [0, 1] as const) {
      expect(slats.bounds!.min[k]).toBeGreaterThanOrEqual(trim.bounds!.min[k])
      expect(slats.bounds!.max[k]).toBeLessThanOrEqual(trim.bounds!.max[k])
    }
    expect(at(13).find((part) => part.id === 'slats')!.instances).toBe(13)
  })

  test('a failing parameter sweep makes the design invalid but keeps the measurements', () => {
    const result = validateDesign(stairGuardJson)
    expect(result.valid).toBe(false)
    expect(result.sweep).toMatchObject({ cases: 29, failed: 15 })
    expect(result.diagnostics.filter((d) => d.code === 'sweep')).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('below the ground'),
        hint: expect.stringContaining('y >= 0'),
      }),
    ])
    expect(result.measurements!.datum.balanced).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toContain('unbalanced')
  })

  test('spinning parts get their own draw group', () => {
    const m = validateDesign(condenserJson).measurements!
    expect(m.parts.find((part) => part.id === 'fan')!.motion).toBe('spin')
    expect(m.drawGroups.filter((group) => group.motionGroup === 'fan')).not.toHaveLength(0)
    expect(m.motions).toBe(1)
  })
})

describe('validateDesign diagnostics', () => {
  test('accepts the design as a JSON string', () => {
    expect(validateDesign(JSON.stringify(louverJson))).toEqual(validateDesign(louverJson))
    expect(validateDesign('{"version": 1,')).toMatchObject({
      valid: false,
      diagnostics: [{ severity: 'error', code: 'invalid_json' }],
      measurements: null,
    })
  })

  test('schema issues carry paths and authoring hints', () => {
    const design = louver()
    design.parts[2].count = 'slat_count - 1'
    design.parts[0].shapes[0].slot = 'Frame'
    for (let i = 0; i < 14; i++) design.parts.push({ ...design.parts[0], id: `extra_${i}` })
    const result = validateDesign(design)
    expect(result.valid).toBe(false)
    const byPath = Object.fromEntries(result.diagnostics.map((d) => [d.path, d.message]))
    expect(byPath['parts[2].count']).toContain('arithmetic strings are not supported')
    expect(byPath['parts[0].shapes[0].slot']).toContain('lowercase snake_case')
    expect(byPath.parts).toContain('<=16')
  })

  test('rules JSON Schema cannot express come back as rule errors', () => {
    const design = louver()
    const slats = design.parts[2]
    slats.count = 64
    slats.shapes = [0, 1, 2, 3, 4].map((i) => ({ ...slats.shapes[0], id: `slat_${i}` }))
    expect(validateDesign(design).diagnostics).toEqual([
      {
        severity: 'error',
        code: 'rule',
        message: 'Expanded shape budget exceeded',
        hint: expect.stringContaining('At most 256 shapes'),
      },
    ])
    const unknownSlot = louver()
    unknownSlot.parts[0].shapes[0].slot = 'paint'
    expect(validateDesign(unknownSlot).diagnostics[0]).toMatchObject({
      code: 'rule',
      message: 'Unknown slot paint',
      hint: 'Declared slots: frame.',
    })
    // A wall-side design whose reference names a surface that is not declared.
    const unmounted = louver()
    unmounted.mounting.reference = 'rear'
    expect(validateDesign(unmounted).diagnostics[0]).toMatchObject({
      code: 'rule',
      message: 'Mounting requires one named, non-repeated reference surface',
      hint: expect.stringMatching(
        /^mounting\.reference is "rear"; surfaces without part: back\. Declare surfaces: .*"reference":"back"/,
      ),
    })
  })

  test('parameter values outside the declared ranges are refused', () => {
    for (const parameters of [{ slat_count: 20 }, { width: 1 }]) {
      const result = validateDesign(louverJson, { parameters })
      expect(result.valid).toBe(false)
      expect(result.measurements).toBeNull()
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'parameters', path: 'parameters' }),
      ])
    }
  })

  test('parts that touch nothing are reported with their gaps', () => {
    const design = louver()
    design.parts.push({
      id: 'badge',
      label: 'Badge',
      count: 1,
      shapes: [
        {
          id: 'plate',
          primitive: 'box',
          slot: 'frame',
          size: [0.05, 0.05, 0.01],
          position: [0, 0.47, 0.3],
        },
      ],
    })
    const result = validateDesign(design)
    expect(result.valid).toBe(true)
    expect(result.measurements!.components.count).toBe(2)
    const [warning] = result.diagnostics
    expect(warning).toMatchObject({ severity: 'warning', code: 'floating_component' })
    expect(warning!.message).toContain('badge (1 shape) touches neither')
    expect(result.measurements!.components.list[1]).toMatchObject({
      parts: ['badge'],
      touchesDatum: false,
      datumGap: 0.295,
    })
    // The slats in front of the badge reach z 0.046; the trim ring does not overlap it in x or y.
    expect(result.measurements!.components.list[1]!.nearestGap).toBeCloseTo(0.249, 3)
  })

  test('wall-side geometry behind the wall reference is flagged', () => {
    const design = louver()
    design.parts[0].shapes[0].position[2] = -0.02
    const result = validateDesign(design)
    expect(result.valid).toBe(true)
    expect(result.measurements!.datum.gap).toBeCloseTo(-0.0455, 4)
    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'behind_wall',
        message:
          'trim reaches 0.0455 m behind the wall reference "back" and would pass into the wall',
      },
    ])
  })

  test('library designs with detached pieces are flagged', () => {
    const result = validateDesign(chandelierJson)
    expect(result.valid).toBe(true)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'floating_component',
        message: expect.stringContaining('6 separate groups of bulbs'),
      }),
    ])
  })

  test('reports the triangles the renderer builds next to the charged budget', () => {
    const { triangles } = validateDesign(ceilingFanJson).measurements!
    expect(triangles.actual).toBeLessThan(triangles.budget)
    expect(triangles.limit).toBe(100_000)
  })

  test('the example stands on its four legs', () => {
    const m = validateDesign(DESIGN_EXAMPLE, { parameters: { width: 0.9, height: 0.8 } })
      .measurements!
    expect(m.parts.find((part) => part.id === 'legs')!.instances).toBe(4)
    expect(m.datum.contact).toMatchObject({ parts: ['legs'], shapes: 4, min: [-0.44, -0.44] })
    expect(m.datum.balanced).toBe(true)
    expect(m.surfaces).toEqual(['top:0:board:top'])
  })
})
