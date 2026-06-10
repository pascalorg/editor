import { describe, expect, test } from 'bun:test'
import { isOpenAssemblyCapabilityRequest, planGeometryCapabilities } from './capability-planner'

describe('geometry capability planner', () => {
  test('routes spur gears to the parametric gear recipe', () => {
    const plan = planGeometryCapabilities('spur gear, 20 teeth, module 4.5')
    expect(plan.route).toBe('parametric_gear')
    expect(plan.availableCapabilities).toContain('compose_recipe:gear.spur')
    expect(plan.missingCapabilities).toEqual([])
  })

  test('routes professional standard parts to closed-form recipes', () => {
    const flange = planGeometryCapabilities('standard pipe flange, DN100, 8 bolt holes, 24mm thick')
    expect(flange.route).toBe('recipe')
    expect(flange.availableCapabilities).toContain('compose_recipe:pipe.flange')

    const bolt = planGeometryCapabilities('M8 hex bolt, 40mm shank, visible threads')
    expect(bolt.route).toBe('recipe')
    expect(bolt.availableCapabilities).toContain('compose_recipe:fastener.hexBolt')

    const sprocket = planGeometryCapabilities('roller chain sprocket, 18 teeth')
    expect(sprocket.route).toBe('recipe')
    expect(sprocket.availableCapabilities).toContain('compose_recipe:sprocket.chain')

    const elbow = planGeometryCapabilities('90 degree pipe elbow DN100')
    expect(elbow.route).toBe('recipe')
    expect(elbow.availableCapabilities).toContain('compose_recipe:pipe.elbow90')

    const bearing = planGeometryCapabilities('pillow block bearing for a 50mm shaft')
    expect(bearing.route).toBe('recipe')
    expect(bearing.availableCapabilities).toContain('compose_recipe:bearing.pillowBlock')

    const coupling = planGeometryCapabilities('flexible shaft coupling with six jaws')
    expect(coupling.route).toBe('recipe')
    expect(coupling.availableCapabilities).toContain('compose_recipe:coupling.flexible')

    const plate = planGeometryCapabilities('perforated sieve plate with 3 by 5 holes')
    expect(plate.route).toBe('recipe')
    expect(plate.availableCapabilities).toContain('compose_recipe:plate.perforated')
  })

  test('routes cars to constraint-first assembly', () => {
    const plan = planGeometryCapabilities('generate a car')
    expect(plan.route).toBe('assembly')
    expect(plan.availableCapabilities).toContain('compose_assembly:vehicle')
  })

  test('routes mud mixer impellers to reusable propeller blade parts', () => {
    const plan = planGeometryCapabilities(
      'generate a mud mixer component with one rod and three inclined flat blades',
    )
    expect(plan.route).toBe('mixer_parts')
    expect(plan.availableCapabilities).toContain('compose_parts:propeller_blade_set')
  })

  test('routes complete aircraft to aircraft fuselage defaults', () => {
    const plan = planGeometryCapabilities('生成一架10米长的飞机')

    expect(plan.route).toBe('primitive')
    expect(plan.availableCapabilities).toContain('compose_parts:aircraft_fuselage')
    expect(plan.recommendation).toContain('kind:"aircraft_fuselage"')
    expect(plan.recommendation).toContain('Do not hand-place generic airfoil_blade')
  })

  test('routes common industrial equipment names to generic assembly', () => {
    const lathe = planGeometryCapabilities('生成一个数控车床')
    expect(lathe.route).toBe('assembly')
    expect(lathe.availableCapabilities).toContain('compose_assembly')

    const machiningCenter = planGeometryCapabilities('生成一个加工中心')
    expect(machiningCenter.route).toBe('assembly')
    expect(machiningCenter.availableCapabilities).toContain('compose_assembly')

    const pump = planGeometryCapabilities('生成一个离心泵')
    expect(pump.route).toBe('assembly')
    expect(pump.availableCapabilities).toContain('compose_assembly')

    const drill = planGeometryCapabilities('生成一个钻床')
    expect(drill.route).toBe('assembly')
    expect(drill.availableCapabilities).toContain('compose_assembly')
    expect(drill.recommendation).toContain('variant "drill_press"')

    const labeler = planGeometryCapabilities('生成一个贴标机')
    expect(labeler.route).toBe('assembly')
    expect(labeler.availableCapabilities).toContain('compose_assembly')
    expect(labeler.recommendation).toContain('archetype "packaging.inline_machine"')
  })

  test('routes distillation tower requests to vertical tower assembly', () => {
    const plan = planGeometryCapabilities('做一个化工厂的蒸馏塔，高8米，直径1米')

    expect(plan.route).toBe('assembly')
    expect(plan.availableCapabilities).toContain('compose_assembly:distillation_tower')
    expect(plan.recommendation).toContain('family:"distillation_tower"')
  })

  test('routes plain chimneys to parts instead of tower assembly', () => {
    const plan = planGeometryCapabilities('generate a large chimney, 10 meters tall')

    expect(plan.route).toBe('primitive')
    expect(plan.availableCapabilities).toContain('compose_parts:chimney_stack')
    expect(plan.recommendation).toContain('kind:"chimney_stack"')
    expect(plan.recommendation).toContain('warningStripes:true')
    expect(plan.recommendation).toContain('vertical_pole/circular_base/cylinder')
    expect(plan.recommendation).toContain('compose_assembly family:"tower"')
  })

  test('routes reactor and grate cooler to assembly skeletons', () => {
    const reactor = planGeometryCapabilities('生成一个反应釜')
    expect(reactor.route).toBe('assembly')
    expect(reactor.availableCapabilities).toContain('compose_assembly:reactor')

    const grateCooler = planGeometryCapabilities('生成一个篦冷机')
    expect(grateCooler.route).toBe('assembly')
    expect(grateCooler.availableCapabilities).toContain('compose_assembly:grate_cooler')
  })

  test('does not treat conversational gear phrases as parametric gear requests', () => {
    const conveyor = planGeometryCapabilities('please shift gears on my conveyor')
    expect(conveyor.route).not.toBe('parametric_gear')
    expect(conveyor.availableCapabilities).not.toContain('compose_recipe:gear.spur')

    const gearPump = planGeometryCapabilities('generate a gear pump')
    expect(gearPump.route).toBe('assembly')
    expect(gearPump.availableCapabilities).toContain('compose_assembly')
  })

  test('keeps whole-equipment intents ahead of mixer component routing', () => {
    const reactor = planGeometryCapabilities('generate a reactor with an agitator mixer')
    expect(reactor.route).toBe('assembly')
    expect(reactor.availableCapabilities).toContain('compose_assembly:reactor')

    const ambiguous = planGeometryCapabilities('add a tower crane mixer')
    expect(ambiguous.route).not.toBe('mixer_parts')
    expect(ambiguous.availableCapabilities).not.toContain('compose_parts:propeller_blade_set')
  })

  test('shares open assembly request detection with the executor', () => {
    expect(isOpenAssemblyCapabilityRequest({ recipeId: 'process.grate_cooler' }, '')).toBe(true)
    expect(isOpenAssemblyCapabilityRequest({}, 'generate a grate cooler')).toBe(true)
    expect(isOpenAssemblyCapabilityRequest({ recipeId: 'gear.spur' }, 'spur gear')).toBe(false)
  })
})
