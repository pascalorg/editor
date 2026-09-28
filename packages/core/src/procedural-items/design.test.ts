import { describe, expect, test } from 'bun:test'
import ceilingFanJson from './__fixtures__/ceiling_fan.json'
import chandelierJson from './__fixtures__/chandelier_six_arms.json'
import jointCabinetJson from './__fixtures__/joint_cabinet.json'
import downlightJson from './__fixtures__/recessed_downlight.json'
import condenserJson from './__fixtures__/trial-e1-condenser.json'
import airHandlerJson from './__fixtures__/trial-e2-air-handler.json'
import louverJson from './__fixtures__/trial-e5-louver.json'
import stairGuardJson from './__fixtures__/trial-e8-stair-guard.json'
import {
  DESIGN_EXAMPLE,
  DESIGN_WRITE_VERSION,
  DesignValidationSchema,
  describeDesignSchema,
  validateDesign,
} from './design'
import { evaluateRecipe, parseRecipe, type Recipe } from './recipe'

// Trial fixtures: recipes of real /next elements from the asset-kernel trial, with the
// renderer's triangle and batch counts and the sweep results recorded there.
const louver = () => structuredClone(louverJson) as any

describe('describeDesignSchema', () => {
  test('is JSON Schema generated from RecipeSchema with a named recursive expression', () => {
    const { version, schema, rules, limits, limitsV2, example } = describeDesignSchema()
    const text = JSON.stringify(schema)
    expect(version).toBe(2)
    expect(text.length).toBeLessThan(16_000)
    for (const v2 of ['extrude', 'revolve', 'joints', 'select', 'cuts']) expect(text).toContain(v2)
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
    expect(limitsV2.shapes).toBe(512)
    expect(rules.length).toBeGreaterThan(10)
    expect(validateDesign(example)).toMatchObject({ valid: true, diagnostics: [] })
  })

  test('returns a fresh copy', () => {
    const first = describeDesignSchema()
    first.rules.length = 0
    ;(first.schema as { title?: string }).title = 'changed'
    const second = describeDesignSchema()
    expect(second.rules.length).toBeGreaterThan(10)
    expect(second.schema.title).toBe('Pascal design')
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
    const result = validateDesign(design)
    expect(result.valid).toBe(false)
    const byPath = Object.fromEntries(result.diagnostics.map((d) => [d.path, d.message]))
    expect(byPath['parts[2].count']).toContain('arithmetic strings are not supported')
    expect(byPath['parts[0].shapes[0].slot']).toContain('lowercase snake_case')
  })

  test('a bad slot or light color is reported as a color, not an id', () => {
    const design = louver()
    design.slots[0].color = 'white'
    const result = validateDesign(design)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'schema',
        path: 'slots[0].color',
        message: expect.stringContaining('6-digit hex'),
      }),
    ])
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

  test('inputs JSON cannot serialize are refused, not thrown', () => {
    const cyclic: Record<string, unknown> = louver()
    cyclic.self = cyclic
    const withBigInt = { ...louver(), version: 1n }
    for (const input of [cyclic, withBigInt]) {
      const result = validateDesign(input)
      expect(result.valid).toBe(false)
      expect(result.diagnostics[0]?.code).toBe('rule')
    }
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

  test('geometry far behind the wall does not count as touching it', () => {
    const design = louver()
    // The trim ring, 1 m behind the wall reference: it touches nothing.
    for (const shape of design.parts[0].shapes) shape.position[2] = -1
    const m = validateDesign(design).measurements!
    const trim = m.components.list.find((c) => c.parts.includes('trim'))!
    expect(trim.touchesDatum).toBe(false)
    expect(m.datum.contact!.parts).not.toContain('trim')
    expect(validateDesign(design).diagnostics.map((d) => d.code)).toContain('floating_component')
  })

  test('designs over the draw budget get a draw_budget warning', () => {
    const design = louver()
    design.slots = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      color: '#888888',
    }))
    design.parts = Array.from({ length: 8 }, (_, p) => ({
      id: `p${p}`,
      label: `P${p}`,
      count: 1,
      ...(p > 0 && { motion: { kind: 'slide', axis: 'z', distance: 0.1 } }),
      shapes: Array.from({ length: 8 }, (_, s) => ({
        id: `b${s}`,
        primitive: 'box',
        slot: `s${s}`,
        size: [0.05, 0.05, 0.05],
        position: [p * 0.06 - 0.2, 0.1 + s * 0.06, 0.03],
      })),
    }))
    design.surfaces[0].size = [0.634, 0.94]
    const result = validateDesign(design)
    expect(result.measurements!.drawGroups.length).toBe(64)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'draw_budget' }),
    )
  })

  test('balance weighs a cone as a cone', () => {
    const recipe = structuredClone(DESIGN_EXAMPLE) as any
    recipe.parts = [
      {
        id: 'base',
        label: 'Base',
        count: 1,
        shapes: [
          {
            id: 'plate',
            primitive: 'box',
            slot: 'wood',
            size: [1.6, 0.02, 1.6],
            position: [0, 0.01, 0],
          },
        ],
      },
      {
        id: 'cone',
        label: 'Cone',
        count: 1,
        shapes: [
          {
            id: 'tip',
            primitive: 'cylinder',
            slot: 'wood',
            size: [0.4, 1.2, 0.4],
            position: [1.6, 0.62, 0],
            topScale: 0,
          },
        ],
      },
    ]
    // With the true cone volume (a third of the cylinder) the centre of mass is x ≈ 0.72,
    // inside the plate; weighing it as a full cylinder moves it outside.
    const m = validateDesign(recipe).measurements!
    expect(m.datum.balanced).toBe(true)
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

// A v2 floor lamp: a revolved base, an extruded stem, an open faceted shade and an optional
// finial gated by a bool parameter.
const lamp = (): Recipe => ({
  version: 2,
  name: 'Floor lamp',
  description: 'Revolved base, extruded stem, open shade, optional finial.',
  parameters: [
    { id: 'finial', label: 'Finial', default: 1, min: 0, max: 1, step: 1, unit: 'bool' },
  ],
  slots: [
    { id: 'metal', label: 'Metal', color: '#444444', finish: 'metal' },
    { id: 'shade', label: 'Shade', color: '#f0e8d8' },
  ],
  parts: [
    {
      id: 'base',
      label: 'Base',
      count: 1,
      shapes: [
        {
          id: 'foot',
          primitive: 'revolve',
          slot: 'metal',
          profile: [
            [0, 0],
            [0.12, 0],
            [0.1, 0.03],
            [0, 0.03],
          ],
          position: [0, 0, 0],
        },
        {
          id: 'stem',
          primitive: 'extrude',
          slot: 'metal',
          section: { kind: 'round', radius: 0.01 },
          length: 0.5,
          position: [0, 0.28, 0],
          rotation: [-Math.PI / 2, 0, 0],
        },
        {
          id: 'shade',
          primitive: 'cylinder',
          slot: 'shade',
          size: [0.3, 0.2, 0.3],
          position: [0, 0.6, 0],
          topScale: 0.7,
          segments: 12,
          open: true,
        },
      ],
    },
    {
      id: 'finial',
      label: 'Finial',
      count: 1,
      when: 'finial',
      shapes: [
        {
          id: 'knob',
          primitive: 'ellipsoid',
          slot: 'metal',
          size: [0.03, 0.03, 0.03],
          position: [0, 0.715, 0],
        },
      ],
    },
  ],
  constraints: [],
})

describe('validateDesign on version 2 designs', () => {
  test('extrude, revolve, cylinder options and when are validated and measured', () => {
    const result = validateDesign(lamp())
    expect(DesignValidationSchema.parse(result)).toEqual(result)
    expect(result.valid).toBe(true)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['design_version_not_enabled'])
    const m = result.measurements!
    expect(m.triangles.actual).toBe(evaluateRecipe(parseRecipe(lamp())).triangles)
    expect(m.triangles.budget).toBe(m.triangles.actual)
    expect(m.components.count).toBe(1)
    expect(m.datum).toMatchObject({ kind: 'floor', gap: 0, balanced: true })
    expect(m.parts.find((part) => part.id === 'finial')!.instances).toBe(1)
    const without = validateDesign(lamp(), { parameters: { finial: 0 } }).measurements!
    expect(without.parts.find((part) => part.id === 'finial')).toMatchObject({
      instances: 0,
      shapes: 0,
      bounds: null,
    })
  })

  test('jointed parts report the motion their joint evaluates to', () => {
    const result = validateDesign(jointCabinetJson)
    expect(result.valid).toBe(true)
    const recipe = parseRecipe(jointCabinetJson)
    const motions = evaluateRecipe(recipe).motions
    expect(motions.length).toBeGreaterThan(0)
    for (const motion of motions)
      expect(result.measurements!.parts.find((part) => part.id === motion.partId)!.motion).toBe(
        motion.kind,
      )
  })

  test('a recessed ceiling design measures against its reference', () => {
    const result = validateDesign(downlightJson)
    expect(result.valid).toBe(true)
    expect(result.measurements!.datum).toMatchObject({ kind: 'ceiling', gap: expect.any(Number) })
  })

  test('version 2 validates fully but warns that placement accepts version 1 only', () => {
    expect(DESIGN_WRITE_VERSION).toBe(1)
    expect(validateDesign(lamp()).diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'design_version_not_enabled',
        path: 'version',
        message: expect.stringContaining('placement accepts version 1 only'),
      },
    ])
    expect(validateDesign(DESIGN_EXAMPLE).diagnostics).toEqual([])
  })

  test('v2 content in a version 1 design says to set version 2', () => {
    const design = { ...lamp(), version: 1 }
    const diagnostic = validateDesign(design).diagnostics[0]!
    expect(diagnostic).toMatchObject({ severity: 'error', code: 'schema' })
    expect(diagnostic.message).toContain('requires recipe version 2')
    expect(diagnostic.hint).toContain('"version": 2')
  })

  test('arithmetic strings in v2 expression fields get the expression hint', () => {
    const design = lamp() as any
    design.parts[0].shapes[1].length = 'height - 0.1'
    const byPath = Object.fromEntries(
      validateDesign(design).diagnostics.map((d) => [d.path, d.message]),
    )
    expect(byPath['parts[0].shapes[1].length']).toContain('arithmetic strings are not supported')
  })
})
