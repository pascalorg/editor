import { describe, expect, test } from 'bun:test'
import { composeAssemblyPrimitives } from './assembly-compose'
import { composePartPrimitives } from './part-compose'
import type { PrimitiveShapeInput } from './primitive-compose'
import { resolvePrimitiveWorldTransforms } from './primitive-compose'
import { composeRecipePrimitives } from './primitive-recipes'
import { validatePrimitiveSemantics } from './primitive-semantic-validation'
import { composeRobotArmPrimitives } from './robot-arm-compose'

function validate(shapes: PrimitiveShapeInput[], prompt: string, category: string) {
  return validatePrimitiveSemantics(
    shapes,
    resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
    {
      prompt,
      geometryBrief: { category },
    },
  )
}

describe('validatePrimitiveSemantics', () => {
  test('accepts a bicycle wheel component without requiring a complete bicycle', () => {
    const shapes = composePartPrimitives({
      name: 'single bicycle wheel',
      geometryBrief: {
        category: 'bicycle_component',
        requiredRoles: ['bicycle_tire:1', 'bicycle_rim:1', 'bicycle_hub:1', 'bicycle_spoke:8'],
      },
      parts: [{ kind: 'wheel_set', semanticRole: 'bicycle_wheel', radius: 0.35 }],
    })

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'generate one bicycle wheel',
        geometryBrief: {
          category: 'bicycle_component',
          requiredRoles: ['bicycle_tire:1', 'bicycle_rim:1', 'bicycle_hub:1', 'bicycle_spoke:8'],
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.family).toBe('unknown')
    expect(result.facts.roles.bicycle_tire).toBe(1)
    expect(result.facts.roles.bicycle_spoke).toBe(8)
  })

  test('accepts a red vehicle assembled from reusable primitive parts', () => {
    const shapes = composePartPrimitives({
      name: 'Red sedan',
      primaryColor: '#cc0000',
      parts: [{ kind: 'vehicle_body', length: 4.4, width: 1.8, height: 1.35 }],
    })

    const result = validate(shapes, 'red sedan car', 'vehicle')

    expect(result.ok).toBe(true)
    expect(result.family).toBe('vehicle')
    expect(result.facts.roles.vehicle_body).toBe(1)
    expect(result.facts.roles.vehicle_tire).toBe(4)
    expect(result.facts.roles.vehicle_window).toBeGreaterThanOrEqual(4)
    expect(result.facts.roles.headlight).toBe(2)
    expect(result.facts.roles.front_bumper).toBe(1)
    expect(result.facts.roles.rear_bumper).toBe(1)
  })

  test('rejects vehicle geometry that cannot satisfy four-wheel car semantics', () => {
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'box',
        name: 'bad car body',
        semanticRole: 'vehicle_body',
        position: [0, 0.55, 0],
        length: 4,
        width: 1.8,
        height: 0.7,
        material: { properties: { color: '#cc0000' } },
      },
      {
        kind: 'torus',
        name: 'bad car left tire',
        semanticRole: 'vehicle_tire',
        position: [-1.2, 0.25, -0.85],
        axis: 'z',
        majorRadius: 0.28,
        tubeRadius: 0.07,
      },
      {
        kind: 'torus',
        name: 'bad car right tire',
        semanticRole: 'vehicle_tire',
        position: [1.2, 0.25, -0.85],
        axis: 'z',
        majorRadius: 0.28,
        tubeRadius: 0.07,
      },
      {
        kind: 'rounded-panel',
        name: 'bad car windshield',
        semanticRole: 'vehicle_window',
        position: [0.4, 1.02, 0],
        length: 0.4,
        width: 1,
        thickness: 0.02,
      },
      {
        kind: 'sphere',
        name: 'bad car left headlight',
        semanticRole: 'headlight',
        position: [1.95, 0.55, -0.45],
        radius: 0.05,
      },
      {
        kind: 'sphere',
        name: 'bad car right headlight',
        semanticRole: 'headlight',
        position: [1.95, 0.55, 0.45],
        radius: 0.05,
      },
      {
        kind: 'box',
        name: 'front bumper',
        semanticRole: 'front_bumper',
        position: [2.05, 0.32, 0],
        length: 0.06,
        width: 1.5,
        height: 0.08,
      },
      {
        kind: 'box',
        name: 'rear bumper',
        semanticRole: 'rear_bumper',
        position: [-2.05, 0.32, 0],
        length: 0.06,
        width: 1.5,
        height: 0.08,
      },
    ]

    const result = validate(shapes, 'red car', 'vehicle')

    expect(result.ok).toBe(false)
    expect(result.issues).toContain(
      'vehicle requires exactly 4 tires arranged as two axles, got 2.',
    )
  })

  test('does not treat revision-only vehicle roles as a complete passenger car request', () => {
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'box',
        name: 'agv cart body',
        semanticRole: 'vehicle_body',
        position: [0, 0.35, 0],
        length: 1.4,
        width: 0.8,
        height: 0.35,
      },
      {
        kind: 'torus',
        name: 'left drive tire',
        semanticRole: 'vehicle_tire',
        position: [-0.4, 0.2, -0.45],
        axis: 'z',
        majorRadius: 0.16,
        tubeRadius: 0.04,
      },
      {
        kind: 'box',
        name: 'navigation sensor mast',
        semanticRole: 'navigation_sensor',
        position: [0.45, 0.75, 0],
        length: 0.08,
        width: 0.08,
        height: 0.35,
      },
    ]

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'make it blue',
        geometryBrief: { category: 'generic body assembly' },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.family).toBe('unknown')
    expect(result.issues).not.toContain('vehicle requires exactly 1 main body shell, got 1.')
    expect(result.issues.some((issue) => issue.includes('vehicle requires'))).toBe(false)
  })

  test('accepts car tire required-role aliases for single vehicle wheel components', () => {
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'torus',
        name: 'single car tire',
        semanticRole: 'vehicle_tire',
        position: [0, 0.3, 0],
        axis: 'z',
        majorRadius: 0.32,
        tubeRadius: 0.08,
      },
      {
        kind: 'cylinder',
        name: 'single car wheel hub',
        semanticRole: 'wheel_hub',
        position: [0, 0.3, 0],
        axis: 'z',
        radius: 0.16,
        height: 0.04,
      },
    ]

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: '\u751f\u6210\u4e00\u4e2a\u6c7d\u8f66\u8f6e\u80ce',
        geometryBrief: { category: 'vehicle component', requiredRoles: ['car_tire'] },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.family).toBe('unknown')
    expect(result.issues).not.toContain('required semantic role "vehicle_tire" is missing.')
    expect(result.issues.some((issue) => issue.includes('vehicle requires exactly 4 tires'))).toBe(
      false,
    )
  })

  test('treats vehicle-domain component briefs as single parts, not complete cars', () => {
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'torus',
        name: 'steering wheel outer rim',
        position: [0, 1, 0],
        axis: 'z',
        majorRadius: 0.24,
        tubeRadius: 0.025,
      },
      {
        kind: 'cylinder',
        name: 'steering wheel center hub',
        position: [0, 1, 0],
        axis: 'z',
        radius: 0.06,
        height: 0.04,
      },
      ...[0, 1, 2].map(
        (index): PrimitiveShapeInput => ({
          kind: 'box',
          name: 'steering wheel spoke',
          position: [0, 1, 0],
          rotation: [0, 0, (index * Math.PI * 2) / 3],
          length: 0.34,
          width: 0.018,
          height: 0.018,
        }),
      ),
    ]

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'generate a steering wheel',
        geometryBrief: {
          category: 'vehicle',
          requiredRoles: ['steering_wheel_rim', 'steering_wheel_hub', 'steering_wheel_spoke'],
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.family).toBe('unknown')
    expect(result.issues).not.toContain('vehicle requires exactly 1 main body shell, got 0.')
  })

  test('accepts common steering wheel role aliases from Chinese generation plans', () => {
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'torus',
        semanticRole: 'wheel_rim',
        position: [0, 0, 0],
        axis: 'y',
        majorRadius: 0.175,
        tubeRadius: 0.015,
      },
      {
        kind: 'cylinder',
        semanticRole: 'center_hub',
        position: [0, 0, 0],
        axis: 'y',
        radius: 0.06,
        height: 0.08,
      },
      {
        kind: 'capsule',
        semanticRole: 'spoke',
        position: [0.0875, 0, 0],
        axis: 'x',
        radius: 0.012,
        height: 0.115,
      },
    ]

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: '生成一个汽车方向盘',
        geometryBrief: {
          category: 'automotive steering wheel',
          requiredRoles: ['wheel_rim', 'center_hub', 'spoke'],
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.family).toBe('unknown')
    expect(result.issues).not.toContain('required semantic role "center_hub" is missing.')
    expect(result.issues).not.toContain('required semantic role "spoke" is missing.')
  })

  test('accepts aircraft part defaults with common LLM role aliases', () => {
    const shapes = composePartPrimitives({
      name: 'Boeing airliner',
      length: 8,
      geometryBrief: { category: 'aircraft', expectedDimensions: { length: 8 } },
      parts: [{ kind: 'aircraft_fuselage' }],
    })

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: '生成一个波音客机，长8米',
        geometryBrief: {
          category: 'aircraft',
          requiredRoles: [
            'aircraft_body',
            'complete_airframe',
            'fuselage_body',
            'aircraft_fuselage',
            'aircraft_wing',
            'aircraft_horizontal_stabilizer',
            'aircraft_vertical_stabilizer',
            'aircraft_landing_gear_main',
            'cockpit_windows',
            'aircraft_window',
            'engine_nacelle_left',
            'engine_nacelle_right',
            'engine',
          ],
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.facts.roles.engine_nacelle_left).toBe(1)
    expect(result.facts.roles.engine_nacelle_right).toBe(1)
    expect(shapes.length).toBeLessThanOrEqual(80)
  })

  test('accepts a bicycle with one deduplicated two-wheel wheelset', () => {
    const shapes = composePartPrimitives({
      name: 'Duplicate wheelset bike',
      parts: [{ kind: 'bicycle_wheels' }, { kind: 'bike_wheelset' }, { kind: 'bicycle_frame' }],
    })

    const result = validate(shapes, 'red bicycle', 'bicycle')

    expect(result.ok).toBe(true)
    expect(result.facts.roles.bicycle_tire).toBe(2)
    expect(result.facts.roles.bicycle_frame).toBeGreaterThan(0)
    expect(result.facts.roles.bicycle_fork).toBeGreaterThan(0)
    expect(result.facts.roles.handlebar).toBeGreaterThan(0)
    expect(result.facts.roles.saddle).toBeGreaterThan(0)
    expect(result.facts.roles.chain_loop).toBeGreaterThan(0)
  })

  test('accepts bicycle part-kind aliases in geometry brief required roles', () => {
    const shapes = composePartPrimitives({
      name: 'Correct bicycle',
      parts: [
        { kind: 'bicycle_wheels' },
        { kind: 'bicycle_frame' },
        { kind: 'bicycle_fork' },
        { kind: 'handlebar' },
        { kind: 'saddle' },
        { kind: 'chain_loop' },
      ],
    })
    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: '生成一个新的正确自行车模型',
        geometryBrief: {
          category: 'bicycle',
          requiredRoles: ['bicycle_wheels', 'frame', 'fork', 'handlebar', 'saddle', 'chain_drive'],
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.issues).not.toContain('required semantic role "chain_drive" is missing.')
    expect(result.issues).not.toContain('required semantic role "chain_loop" is missing.')
  })

  test('accepts LLM-style complete bicycle aliases without losing canonical roles', () => {
    const shapes = composePartPrimitives({
      name: 'red bicycle',
      primaryColor: '#CC0000',
      parts: [
        { id: 'frame', kind: 'bicycle_frame', semanticRole: 'frame' },
        { id: 'fork', kind: 'bicycle_fork', semanticRole: 'fork' },
        { id: 'wheel_front', kind: 'bicycle_wheel', semanticRole: 'wheel' },
        { id: 'wheel_rear', kind: 'bicycle_wheel', semanticRole: 'wheel' },
        { id: 'handlebar', kind: 'bicycle_handlebar', semanticRole: 'bicycle_handlebar' },
        { id: 'seat', kind: 'bicycle_seat', semanticRole: 'bicycle_saddle' },
        { id: 'crank', kind: 'bicycle_crank', semanticRole: 'crank' },
        { id: 'chainring', kind: 'bicycle_chainring', semanticRole: 'chainring' },
        { id: 'pedals', kind: 'bicycle_pedals', semanticRole: 'pedal' },
        { id: 'chain', kind: 'bicycle_chain', semanticRole: 'chain' },
      ],
    })

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: '生成一辆红色自行车',
        geometryBrief: {
          category: 'complete_bicycle',
          requiredRoles: [
            'frame',
            'fork',
            'wheel_front',
            'wheel_rear',
            'bicycle_handlebar',
            'bicycle_saddle',
            'crank',
            'chainring',
            'pedals',
            'chain',
          ],
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.facts.roles.bicycle_tire).toBe(2)
    expect(result.facts.roles.bicycle_frame).toBeGreaterThan(0)
    expect(result.facts.roles.bicycle_fork).toBeGreaterThan(0)
    expect(result.facts.roles.handlebar).toBeGreaterThan(0)
    expect(result.facts.roles.saddle).toBeGreaterThan(0)
    expect(result.facts.roles.crank).toBeGreaterThan(0)
    expect(result.facts.roles.chainring).toBeGreaterThan(0)
    expect(result.facts.roles.pedal).toBe(2)
  })

  test('accepts chain_drive semantic role as a bicycle chain-loop equivalent', () => {
    const shapes = composePartPrimitives({
      name: 'Correct bicycle',
      parts: [
        { kind: 'bicycle_wheels' },
        { kind: 'bicycle_frame' },
        { kind: 'bicycle_fork' },
        { kind: 'handlebar' },
        { kind: 'saddle' },
        { kind: 'chain_loop' },
      ],
    }).map((shape) =>
      shape.semanticRole === 'chain_loop' ? { ...shape, semanticRole: 'chain_drive' } : shape,
    )

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'generate a bicycle',
        geometryBrief: {
          category: 'complete_bicycle',
          requiredRoles: [
            'bicycle_tire',
            'bicycle_frame',
            'bicycle_fork',
            'handlebar',
            'saddle',
            'chain_loop',
          ],
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.facts.roles.chain_drive).toBeGreaterThan(0)
    expect(result.issues).not.toContain('bicycle requires chain_loop.')
  })

  test('accepts compose_robot_arm output with readable semantic roles', () => {
    const shapes = composeRobotArmPrimitives({
      name: '3-axis robot arm',
      axisCount: 3,
      baseShape: 'round',
      pose: 'work-ready',
      endEffector: 'gripper',
    })

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'generate a 3-axis robot arm with round base',
        geometryBrief: { category: 'robot_arm' },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.family).toBe('robot_arm')
    expect(result.facts.roles.robot_base).toBe(1)
    expect(result.facts.roles.base_joint).toBe(1)
    expect(result.facts.roles.shoulder_joint).toBe(1)
    expect(result.facts.roles.elbow_joint).toBe(1)
    expect(result.facts.roles.upper_arm).toBe(1)
    expect(result.facts.roles.forearm).toBe(1)
    expect(result.facts.roles.end_effector).toBe(1)
  })

  test('accepts industrial role aliases from LLM blueprints', () => {
    const shapes = [
      { kind: 'box', semanticRole: 'support_base', sourcePartKind: 'skid_base', length: 2.6 },
      { kind: 'cylinder', semanticRole: 'volute_casing', radius: 0.3, height: 0.28 },
      { kind: 'cylinder', semanticRole: 'inlet_port', radius: 0.12, height: 0.35 },
      { kind: 'cylinder', semanticRole: 'outlet_port', radius: 0.1, height: 0.35 },
      { kind: 'cylinder', semanticRole: 'drive_motor', radius: 0.28, height: 1.1 },
      { kind: 'box', semanticRole: 'control_box', sourcePartKind: 'control_box' },
      { kind: 'torus', semanticRole: 'flange', sourcePartKind: 'flange_ring' },
    ] as const

    const result = validatePrimitiveSemantics(shapes, [], {
      prompt: 'generate an industrial centrifugal pump skid',
      geometryBrief: {
        category: 'pump',
        requiredRoles: [
          'base_frame',
          'pump_volute',
          'inlet_nozzle',
          'outlet_nozzle',
          'drive_motor',
          'junction_box',
          'shaft_coupling',
          'inlet_flange',
          'outlet_flange',
        ],
      },
    })

    expect(result.ok).toBe(true)
  })

  test('accepts mixer impeller recipe with shaft, hub, and radial blades', () => {
    const shapes = composeRecipePrimitives({
      recipeId: 'mixer.impeller',
      params: { bladeCount: 3 },
    })

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'generate a mud mixer with one rod and three inclined flat blades',
        geometryBrief: { category: 'mixer' },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.family).toBe('mixer')
    expect(result.facts.roles.mixer_shaft).toBe(1)
    expect(result.facts.roles.mixer_hub).toBe(1)
    expect(result.facts.roles.mixer_blade).toBe(3)
  })

  test('accepts industrial assembly families through semantic validation', () => {
    for (const input of [
      { family: 'machine_tool', object: 'lathe' },
      { family: 'machine_tool', object: 'machining center' },
      { family: 'conveyor', object: 'belt conveyor' },
      { family: 'pump', object: 'centrifugal pump' },
      { family: 'distillation_tower', object: 'heat exchanger tower' },
      { family: 'machine_tool', object: 'laser cutter' },
    ]) {
      const shapes = composeAssemblyPrimitives(input)
      const result = validatePrimitiveSemantics(
        shapes,
        resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
        {
          prompt: `generate ${input.object}`,
          geometryBrief: { category: 'industrial_equipment' },
        },
      )

      expect(result.ok).toBe(true)
    }
  })
})
