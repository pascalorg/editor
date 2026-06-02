import { describe, expect, test } from 'bun:test'
import {
  composeRecipePrimitives,
  findPrimitiveRecipe,
  getPrimitiveRecipeGeometryBrief,
  listPrimitiveRecipes,
} from './primitive-recipes'

describe('primitive recipe registry', () => {
  test('lists built-in recipes and resolves aliases', () => {
    expect(listPrimitiveRecipes().map((recipe) => recipe.id)).toContain('vehicle.sedan')
    expect(listPrimitiveRecipes().map((recipe) => recipe.id)).toContain('gear.spur')
    expect(findPrimitiveRecipe({ name: 'small red car' })?.id).toBe('vehicle.sedan')
    expect(findPrimitiveRecipe({ name: '20 tooth spur gear' })?.id).toBe('gear.spur')
    expect(findPrimitiveRecipe({ name: 'quarter turn ball valve' })?.id).toBe('valve.ball')
  })

  test('composes a parametric spur gear recipe with bore and keyway', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'gear.spur',
      params: {
        teeth: 20,
        module: 4.5,
        outerDiameter: 0.099,
        thickness: 0.02,
        boreDiameter: 0.025,
        keywayWidth: 0.008,
        keywayDepth: 0.004,
      },
    })

    expect(shapes).toHaveLength(1)
    const gear = shapes[0]
    expect(gear?.kind).toBe('extrude')
    expect(gear?.semanticRole).toBe('spur_gear')
    expect(gear?.profile?.length).toBe(80)
    expect(gear?.holes).toHaveLength(1)
    expect(gear?.holes?.[0]?.length).toBeGreaterThan(40)
    expect(gear?.depth).toBeCloseTo(0.02)
  })

  test('composes a compact red sedan recipe through reusable vehicle parts', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'vehicle.sedan',
      params: {
        color: '#cc0000',
        size: 'small',
      },
    })

    const body = shapes.find((shape) => shape.semanticRole === 'vehicle_body')
    expect(body?.length).toBeCloseTo(3.52)
    expect(body?.width).toBeCloseTo(1.44)
    expect(body?.material?.properties?.color).toBe('#cc0000')
    expect(shapes.filter((shape) => shape.semanticRole === 'vehicle_tire')).toHaveLength(4)
    expect(shapes.some((shape) => shape.semanticRole === 'vehicle_window')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'vehicle_roof')).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('integrated vehicle glasshouse'))).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'vehicle_pillar')).toHaveLength(6)
    expect(shapes.find((shape) => shape.name?.includes('front deck hood'))?.kind).toBe('wedge')
    expect(shapes.some((shape) => shape.name?.includes('wheel arch shadow'))).toBe(true)
  })

  test('composes valve recipe variants without user-specified internal roles', () => {
    const gate = composeRecipePrimitives({ recipeId: 'valve.gate' })
    expect(gate.some((shape) => shape.semanticRole === 'gate_wedge')).toBe(true)
    expect(gate.some((shape) => shape.semanticRole === 'flange_inlet')).toBe(true)
    expect(gate.some((shape) => shape.semanticRole === 'flange_outlet')).toBe(true)

    const ball = composeRecipePrimitives({ recipeId: 'valve.ball' })
    expect(ball.some((shape) => shape.semanticRole === 'valve_ball')).toBe(true)
    expect(ball.some((shape) => shape.semanticRole === 'valve_bore')).toBe(true)
    expect(ball.some((shape) => shape.semanticRole === 'gate_wedge')).toBe(false)
  })

  test('composes a three-axis robot arm recipe and provides validation brief', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'robotArm.threeAxis',
      params: { baseShape: 'round', endEffector: 'gripper' },
    })
    const roles = new Set(shapes.map((shape) => shape.semanticRole).filter(Boolean))

    expect(roles.has('robot_base')).toBe(true)
    expect(roles.has('base_joint')).toBe(true)
    expect(roles.has('shoulder_joint')).toBe(true)
    expect(roles.has('elbow_joint')).toBe(true)
    expect(roles.has('end_effector')).toBe(true)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'robotArm.threeAxis' })?.category).toBe(
      'robot_arm',
    )
  })
})
