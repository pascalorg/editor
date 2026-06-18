import { describe, expect, test } from 'bun:test'
import { composePartPrimitives } from './part-compose'
import { normalizePartPlanForFamily } from './part-registry'
import { composeRecipePrimitives } from './primitive-recipes'
import { getPrimitiveDefinition, lowerDerivedPrimitiveShape } from './primitive-registry'

describe('geometry layer boundaries', () => {
  test('primitive registry stays pure geometry without family semantics', () => {
    expect(getPrimitiveDefinition('oval')?.kind).toBe('ellipsoid')

    const lowered = lowerDerivedPrimitiveShape({
      kind: 'ellipse-panel',
      length: 1.2,
      width: 0.6,
      thickness: 0.04,
      segments: 16,
    })

    expect(lowered).toMatchObject({ kind: 'extrude', depth: 0.04 })
    expect(lowered.profile).toHaveLength(16)
  })

  test('recipe registry stays a closed standard-part generator', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'pipe.flange',
      nominalDiameter: 0.28,
      boltCount: 8,
    })

    expect(shapes.length).toBeGreaterThan(2)
    expect(shapes.some((shape) => shape.semanticRole === 'flange_body')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'flange_bolt_hole')).toBe(true)
  })

  test('part registry normalizes loose LLM parts before composition', () => {
    const plan = normalizePartPlanForFamily('pump', {
      parts: [
        { kind: 'baseplate' },
        { kind: 'motor_body', params: { ribCount: 12 } },
        { kind: 'pump_body' },
        { kind: 'suction_port' },
        { kind: 'discharge_port' },
      ],
    })

    expect(plan?.warnings).toEqual([])
    expect(plan?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skid_base', semanticRole: 'support_base' }),
        expect.objectContaining({ kind: 'ribbed_motor_body', semanticRole: 'drive_motor' }),
        expect.objectContaining({ kind: 'volute_casing', semanticRole: 'volute_casing' }),
      ]),
    )

    const shapes = composePartPrimitives({
      family: 'pump',
      registryPartPlan: true,
      autoComplete: false,
      parts: plan?.parts ?? [],
    })
    expect(shapes.length).toBeGreaterThan(6)
  })
})
