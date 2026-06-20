import { describe, expect, test } from 'bun:test'
import {
  composeRecipePrimitives,
  findPrimitiveRecipe,
  getPrimitiveRecipeGeometryBrief,
  listPrimitiveRecipes,
} from './primitive-recipes'

function expectBladeRotationMatchesRadialPlacement(shape: {
  position?: number[]
  rotation?: number[]
}) {
  const [x = 0, , z = 0] = shape.position ?? []
  const radialLength = Math.hypot(x, z)
  expect(radialLength).toBeGreaterThan(0.001)
  const expectedAngle = Math.atan2(z, x)
  const actualY = shape.rotation?.[1] ?? 0
  const actualZ = shape.rotation?.[2] ?? 0
  const wrappedDelta = Math.atan2(
    Math.sin(actualZ + expectedAngle),
    Math.cos(actualZ + expectedAngle),
  )
  expect(actualY).toBeCloseTo(0, 4)
  expect(wrappedDelta).toBeCloseTo(0, 4)
}

describe('primitive recipe registry', () => {
  test('keeps closed-form recipes independent from part composition', async () => {
    const source = await Bun.file(`${import.meta.dir}/primitive-recipes.ts`).text()

    expect(source).not.toContain("from './part-compose'")
    expect(source).not.toContain('composePartPrimitives')
  })

  test('lists only closed-form professional recipes and resolves aliases', () => {
    expect(listPrimitiveRecipes().map((recipe) => recipe.id)).toEqual([
      'gear.spur',
      'sprocket.chain',
      'pipe.flange',
      'pipe.elbow90',
      'fastener.hexBolt',
      'bearing.pillowBlock',
      'coupling.flexible',
      'plate.perforated',
      'valve.gate',
      'valve.ball',
      'robotArm.threeAxis',
      'mixer.impeller',
      'motor.servo',
      'process.vesselShell',
      'structure.platformLadder',
      'enclosure.roundedBox',
    ])

    expect(findPrimitiveRecipe({ name: '20 tooth spur gear' })?.id).toBe('gear.spur')
    expect(findPrimitiveRecipe({ name: 'roller chain sprocket' })?.id).toBe('sprocket.chain')
    expect(findPrimitiveRecipe({ name: 'ansi pipe flange' })?.id).toBe('pipe.flange')
    expect(findPrimitiveRecipe({ name: '90 degree elbow fitting' })?.id).toBe('pipe.elbow90')
    expect(findPrimitiveRecipe({ name: 'M8 hex bolt' })?.id).toBe('fastener.hexBolt')
    expect(findPrimitiveRecipe({ name: 'pillow block bearing' })?.id).toBe('bearing.pillowBlock')
    expect(findPrimitiveRecipe({ name: 'flexible shaft coupling' })?.id).toBe('coupling.flexible')
    expect(findPrimitiveRecipe({ name: 'perforated sieve plate' })?.id).toBe('plate.perforated')
    expect(findPrimitiveRecipe({ name: 'quarter turn ball valve' })?.id).toBe('valve.ball')
    expect(findPrimitiveRecipe({ name: 'industrial servo motor' })?.id).toBe('motor.servo')
    expect(findPrimitiveRecipe({ name: '\u4f3a\u670d\u7535\u673a' })?.id).toBe('motor.servo')
    expect(findPrimitiveRecipe({ name: 'hollow pressure vessel shell' })?.id).toBe(
      'process.vesselShell',
    )
    expect(findPrimitiveRecipe({ name: 'access platform ladder with guardrail' })?.id).toBe(
      'structure.platformLadder',
    )
    expect(findPrimitiveRecipe({ name: 'rounded machine cabinet enclosure' })?.id).toBe(
      'enclosure.roundedBox',
    )
    expect(findPrimitiveRecipe({ name: 'mud mixer with three flat blades' })?.id).toBe(
      'mixer.impeller',
    )
  })

  test('does not expose open-ended complete objects as recipes', () => {
    for (const recipeId of [
      'vehicle.sedan',
      'appliance.airConditionerOutdoorUnit',
      'fan.industrial',
      'machineTool.lathe',
      'machineTool.machiningCenter',
      'materialHandling.beltConveyor',
      'fluidMachine.centrifugalPump',
      'process.heatExchanger',
      'forming.injectionMolding',
    ]) {
      expect(findPrimitiveRecipe({ recipeId })?.id).toBeUndefined()
      expect(composeRecipePrimitives({ recipeId })).toEqual([])
    }

    expect(findPrimitiveRecipe({ name: 'small red car' })?.id).toBeUndefined()
    expect(findPrimitiveRecipe({ name: 'outdoor ac condenser unit' })?.id).toBeUndefined()
    expect(findPrimitiveRecipe({ name: 'factory pedestal industrial fan' })?.id).toBeUndefined()
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

  test('composes a standard pipe flange recipe with raised face and bolt circle', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'pipe.flange',
      params: {
        nominalDiameter: 0.1,
        outerDiameter: 0.22,
        thickness: 0.024,
        boltCircleDiameter: 0.18,
        boltCount: 8,
      },
    })
    const roles = new Set(shapes.map((shape) => shape.semanticRole).filter(Boolean))

    expect(roles.has('flange_body')).toBe(true)
    expect(roles.has('raised_face')).toBe(true)
    expect(roles.has('gasket')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'flange_bolt_hole')).toHaveLength(8)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'pipe.flange' })?.category).toBe(
      'pipe_flange',
    )
  })

  test('composes a roller chain sprocket recipe with teeth, hub, and bore', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'sprocket.chain',
      params: { teeth: 16, module: 0.012, boreDiameter: 0.03, thickness: 0.018 },
    })
    const sprocket = shapes.find((shape) => shape.semanticRole === 'chain_sprocket')

    expect(sprocket?.kind).toBe('extrude')
    expect(sprocket?.profile?.length).toBe(80)
    expect(sprocket?.holes).toHaveLength(1)
    expect(shapes.some((shape) => shape.semanticRole === 'sprocket_hub')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'sprocket_bore')).toBe(true)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'sprocket.chain' })?.category).toBe(
      'chain_sprocket',
    )
  })

  test('composes a 90 degree pipe elbow recipe with two end collars', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'pipe.elbow90',
      params: { nominalDiameter: 0.1, bendRadius: 0.15, thickness: 0.008 },
    })

    expect(shapes.some((shape) => shape.semanticRole === 'pipe_elbow_body')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'pipe_elbow_bore')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'elbow_inlet')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'elbow_outlet')).toBe(true)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'pipe.elbow90' })?.category).toBe(
      'pipe_elbow',
    )
  })

  test('composes a hex bolt recipe with shank, six-sided head, and thread crests', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'fastener.hexBolt',
      params: {
        nominalDiameter: 0.008,
        shankLength: 0.04,
        threadLength: 0.018,
      },
    })
    const head = shapes.find((shape) => shape.semanticRole === 'hex_head')

    expect(shapes.some((shape) => shape.semanticRole === 'bolt_shank')).toBe(true)
    expect(head?.radialSegments).toBe(6)
    expect(shapes.filter((shape) => shape.semanticRole === 'thread_crest').length).toBeGreaterThan(
      4,
    )
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'fastener.hexBolt' })?.category).toBe(
      'fastener',
    )
  })

  test('composes a pillow block bearing recipe with housing, insert, and mounting holes', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'bearing.pillowBlock',
      params: { shaftDiameter: 0.05, length: 0.28 },
    })

    expect(shapes.some((shape) => shape.semanticRole === 'pillow_block_base')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'bearing_housing')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'bearing_insert')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'bearing_bore')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'mounting_hole')).toHaveLength(2)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'bearing.pillowBlock' })?.category).toBe(
      'pillow_block_bearing',
    )
  })

  test('composes a flexible coupling recipe with two hubs and an elastomer spider', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'coupling.flexible',
      params: { shaftDiameter: 0.04, jawCount: 6 },
    })

    expect(shapes.some((shape) => shape.semanticRole === 'coupling_hub_left')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'coupling_hub_right')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'elastomer_spider')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'coupling_bore')).toHaveLength(2)
    expect(shapes.filter((shape) => shape.semanticRole === 'set_screw')).toHaveLength(2)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'coupling.flexible' })?.category).toBe(
      'shaft_coupling',
    )
  })

  test('composes a perforated plate recipe with a regular hole grid', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'plate.perforated',
      params: { rows: 3, columns: 5, length: 0.5, width: 0.24, holeDiameter: 0.03 },
    })
    const plate = shapes.find((shape) => shape.semanticRole === 'perforated_plate')

    expect(plate?.kind).toBe('extrude')
    expect(plate?.holes).toHaveLength(15)
    expect(shapes.filter((shape) => shape.semanticRole === 'perforation_hole')).toHaveLength(15)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'plate.perforated' })?.category).toBe(
      'perforated_plate',
    )
  })

  test('composes a hollow process vessel shell recipe with heads and nozzles', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'process.vesselShell',
      params: { length: 1.6, radius: 0.32, wallThickness: 0.025 },
    })
    const roles = new Set(shapes.map((shape) => shape.semanticRole).filter(Boolean))

    expect(shapes.find((shape) => shape.semanticRole === 'vessel_shell')?.kind).toBe(
      'hollow-cylinder',
    )
    expect(shapes.filter((shape) => shape.semanticRole === 'vessel_head')).toHaveLength(2)
    expect(roles.has('vessel_seam')).toBe(true)
    expect(roles.has('top_nozzle')).toBe(true)
    expect(roles.has('manway_flange')).toBe(true)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'process.vesselShell' })?.category).toBe(
      'process_vessel_shell',
    )
  })

  test('composes an industrial platform ladder recipe with guard rails', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'structure.platformLadder',
      params: { length: 1, width: 0.6, height: 1.4, rungCount: 7 },
    })

    expect(shapes.some((shape) => shape.semanticRole === 'platform_deck')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'platform_post')).toHaveLength(4)
    expect(shapes.filter((shape) => shape.semanticRole === 'guard_rail').length).toBeGreaterThan(1)
    expect(shapes.filter((shape) => shape.semanticRole === 'ladder_rung')).toHaveLength(7)
    expect(
      getPrimitiveRecipeGeometryBrief({ recipeId: 'structure.platformLadder' })?.category,
    ).toBe('industrial_access_platform')
  })

  test('composes a rounded box enclosure recipe with a transparent viewing window', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'enclosure.roundedBox',
      params: { length: 1.4, width: 0.5, height: 1.1 },
    })
    const window = shapes.find((shape) => shape.semanticRole === 'viewing_window')

    expect(shapes.find((shape) => shape.semanticRole === 'machine_enclosure')?.kind).toBe('box')
    expect(shapes.some((shape) => shape.semanticRole === 'access_door')).toBe(true)
    expect(window?.kind).toBe('rounded-panel')
    expect(window?.material?.properties?.transparent).toBe(true)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'enclosure.roundedBox' })?.category).toBe(
      'machine_enclosure',
    )
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

  test('composes a friendly mud mixer impeller recipe', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'mixer.impeller',
      params: { bladeCount: 3, bladeTilt: 30, shaftLength: 0.9 },
    })

    expect(shapes.some((shape) => shape.semanticRole === 'mixer_shaft')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'mixer_hub')).toBe(true)
    const bladeSurfaces = shapes.filter((shape) => shape.semanticRole === 'mixer_blade')
    expect(bladeSurfaces).toHaveLength(3)
    expect(bladeSurfaces.every((shape) => shape.kind === 'extrude')).toBe(true)
    expect(bladeSurfaces.every((shape) => shape.sourcePartKind === 'mixer_blades')).toBe(true)
    expect(bladeSurfaces.every((shape) => !shape.name?.includes('segment'))).toBe(true)
    expect(bladeSurfaces.every((shape) => shape.name?.includes('taiji half mixer'))).toBe(true)
    expect(bladeSurfaces.every((shape) => (shape.profile?.length ?? 0) >= 10)).toBe(true)
    bladeSurfaces.forEach(expectBladeRotationMatchesRadialPlacement)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'mixer.impeller' })?.category).toBe('mixer')
  })

  test('composes a servo motor recipe with recognisable servo-specific roles', () => {
    const shapes = composeRecipePrimitives({ recipeId: 'motor.servo' })
    const roles = new Set(shapes.map((shape) => shape.semanticRole).filter(Boolean))

    expect(roles.has('servo_body')).toBe(true)
    expect(roles.has('front_flange')).toBe(true)
    expect(roles.has('output_shaft')).toBe(true)
    expect(roles.has('encoder_cap')).toBe(true)
    expect(roles.has('terminal_box')).toBe(true)
    expect(roles.has('nameplate')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'cooling_fin')).toHaveLength(6)
    expect(shapes.filter((shape) => shape.semanticRole === 'flange_bolt')).toHaveLength(4)
    expect(getPrimitiveRecipeGeometryBrief({ recipeId: 'motor.servo' })?.category).toBe('motor')
  })
})
