import { describe, expect, test } from 'bun:test'
import { composeAssemblyPrimitives } from './assembly-compose'
import { composePartPrimitives } from './part-compose'
import type { PrimitiveShapeInput } from './primitive-compose'
import { resolvePrimitiveWorldTransforms } from './primitive-compose'
import { assessPrimitiveVisualQuality } from './primitive-visual-quality'
import { composeRobotArmPrimitives } from './robot-arm-compose'

function assess(shapes: PrimitiveShapeInput[], prompt = 'car') {
  return assessPrimitiveVisualQuality(
    shapes,
    resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
    {
      prompt,
      geometryBrief: { category: 'vehicle' },
    },
  )
}

describe('assessPrimitiveVisualQuality', () => {
  test('flags a semantic but blocky vehicle as low visual quality', () => {
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'box',
        name: 'block car body',
        semanticRole: 'vehicle_body',
        position: [0, 0.95, 0],
        length: 4,
        width: 1.8,
        height: 1.5,
      },
      ...[-1.35, 1.35].flatMap((x) =>
        [-0.82, 0.82].map(
          (z): PrimitiveShapeInput => ({
            kind: 'torus',
            name: 'block car tire',
            semanticRole: 'vehicle_tire',
            position: [x, 0.3, z],
            axis: 'z',
            majorRadius: 0.25,
            tubeRadius: 0.06,
          }),
        ),
      ),
      {
        kind: 'rounded-panel',
        name: 'single car window sticker',
        semanticRole: 'vehicle_window',
        position: [0.2, 1.55, 0],
        length: 0.7,
        width: 1.1,
        thickness: 0.02,
      },
      {
        kind: 'sphere',
        name: 'left headlight',
        semanticRole: 'headlight',
        position: [1.95, 0.7, -0.45],
        radius: 0.05,
      },
      {
        kind: 'sphere',
        name: 'right headlight',
        semanticRole: 'headlight',
        position: [1.95, 0.7, 0.45],
        radius: 0.05,
      },
      {
        kind: 'box',
        name: 'front bumper',
        semanticRole: 'front_bumper',
        position: [2.05, 0.45, 0],
        length: 0.06,
        width: 1.5,
        height: 0.08,
      },
      {
        kind: 'box',
        name: 'rear bumper',
        semanticRole: 'rear_bumper',
        position: [-2.05, 0.45, 0],
        length: 0.06,
        width: 1.5,
        height: 0.08,
      },
    ]

    const result = assess(shapes)

    expect(result.family).toBe('vehicle')
    expect(result.score).toBeLessThan(0.65)
    expect(result.issues).toContain(
      'vehicle needs a separate cabin/roof mass, not one plain body block.',
    )
    expect(result.issues).toContain('vehicle needs separated windshield/rear/side windows, got 1.')
  })

  test('accepts the default vehicle compose_parts silhouette as visually complete', () => {
    const shapes = composePartPrimitives({
      name: 'Red sedan',
      primaryColor: '#cc0000',
      parts: [{ kind: 'vehicle_body', length: 4.4, width: 1.8, height: 1.35 }],
    })

    const result = assess(shapes, 'red sedan car')

    expect(result.family).toBe('vehicle')
    expect(result.score).toBeGreaterThanOrEqual(0.85)
    expect(result.issues).toEqual([])
    expect(result.metrics.wheelRadiusToLength).toBeGreaterThan(0.045)
  })

  test('accepts compose_robot_arm output as a readable editable robot arm', () => {
    const shapes = composeRobotArmPrimitives({
      name: '3-axis robot arm',
      axisCount: 3,
      pose: 'work-ready',
      endEffector: 'gripper',
      detail: 'medium',
    })

    const result = assessPrimitiveVisualQuality(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'generate a 3-axis robot arm',
        geometryBrief: { category: 'robot_arm' },
      },
    )

    expect(result.family).toBe('robot_arm')
    expect(result.score).toBeGreaterThanOrEqual(0.8)
    expect(result.issues).toEqual([])
    expect(result.metrics.jointCount).toBeGreaterThanOrEqual(3)
  })

  test('composes robot arms with different axis counts without adding workcell clutter', () => {
    const cases = [
      { axisCount: 4, expected: ['wrist_roll_joint'], forbidden: ['wrist_pitch_joint'] },
      { axisCount: 5, expected: ['wrist_roll_joint', 'wrist_pitch_joint'], forbidden: [] },
      { axisCount: 6, expected: ['wrist_roll_joint', 'wrist_pitch_joint'], forbidden: [] },
      {
        axisCount: 7,
        expected: ['redundant_axis_joint', 'wrist_roll_joint', 'wrist_pitch_joint'],
        forbidden: [],
      },
    ]

    for (const testCase of cases) {
      const shapes = composeRobotArmPrimitives({
        name: `${testCase.axisCount}-axis robot arm`,
        axisCount: testCase.axisCount,
        pose: 'work-ready',
        endEffector: 'tool-flange',
      })
      const roles = new Set(shapes.map((shape) => shape.semanticRole))

      expect(roles.has('robot_base')).toBe(true)
      expect(roles.has('shoulder_joint')).toBe(true)
      expect(roles.has('upper_arm')).toBe(true)
      expect(roles.has('forearm')).toBe(true)
      expect(roles.has('wrist_joint')).toBe(true)
      expect(roles.has('work_table')).toBe(false)
      for (const role of testCase.expected) expect(roles.has(role)).toBe(true)
      for (const role of testCase.forbidden) expect(roles.has(role)).toBe(false)
    }
  })

  test('scores standing fan grill depth and blade readability', () => {
    const shapes = composePartPrimitives({
      name: 'Standing fan',
      parts: [{ kind: 'protective_grill' }],
    })

    const result = assessPrimitiveVisualQuality(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'standing electric fan',
        geometryBrief: { category: 'fan' },
      },
    )

    expect(result.family).toBe('fan')
    expect(result.score).toBeGreaterThanOrEqual(0.8)
    expect(result.issues).toEqual([])
    expect(result.metrics.grillRingCount).toBeGreaterThanOrEqual(4)
    expect(result.metrics.grillSideRibCount).toBeGreaterThanOrEqual(6)
  })

  test('flags under-specified industrial equipment and accepts industrial assembly', () => {
    const boxOnly: PrimitiveShapeInput[] = [
      {
        kind: 'box',
        name: 'plain cnc machine block',
        semanticRole: 'machine_base',
        position: [0, 0.5, 0],
        length: 2,
        width: 1,
        height: 1,
      },
    ]
    const poor = assessPrimitiveVisualQuality(
      boxOnly,
      resolvePrimitiveWorldTransforms(boxOnly, { positionMode: 'world-center' }),
      {
        prompt: 'cnc industrial machine',
        geometryBrief: { category: 'industrial_equipment' },
      },
    )
    expect(poor.family).toBe('industrial_equipment')
    expect(poor.score).toBeLessThan(0.7)
    expect(poor.issues).toContain(
      'industrial equipment silhouette is under-specified with only 1 shapes.',
    )

    const shapes = composeAssemblyPrimitives({
      family: 'machine_tool',
      object: 'machining center',
    })
    const good = assessPrimitiveVisualQuality(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'cnc machining center',
        geometryBrief: { category: 'industrial_equipment' },
      },
    )
    expect(good.family).toBe('industrial_equipment')
    expect(good.score).toBeGreaterThanOrEqual(0.8)
    expect(good.issues).toEqual([])
  })

  test('treats reactor assemblies as industrial equipment even when prompt lists robot arm capabilities', () => {
    const shapes = composeAssemblyPrimitives({
      family: 'reactor',
      object: 'stirred reactor',
    })
    const result = assessPrimitiveVisualQuality(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt:
          'Factory geometry capabilities include conveyor, tank, reactor, and robot arm. User asks for 反应釜装置.',
        geometryBrief: { category: 'industrial_process_equipment' },
      },
    )

    expect(result.family).toBe('industrial_equipment')
    expect(result.issues).not.toContain('robot arm visual quality requires robot_base.')
  })

  test('treats AGV material carts as industrial equipment instead of passenger cars', () => {
    const shapes = composePartPrimitives({
      name: 'AGV material cart',
      family: 'generic',
      parts: [
        {
          kind: 'generic_body',
          semanticRole: 'vehicle_body',
          length: 1.4,
          width: 0.85,
          height: 0.28,
        },
        {
          kind: 'generic_base',
          semanticRole: 'cargo_platform',
          length: 1.25,
          width: 0.72,
          height: 0.08,
        },
        { kind: 'wheel_set', semanticRole: 'wheel', count: 4, radius: 0.13, wheelWidth: 0.06 },
        { kind: 'bar_pair', semanticRole: 'bumper', length: 1.25, height: 0.12 },
        {
          kind: 'generic_detail_accent',
          semanticRole: 'navigation_sensor',
          length: 0.18,
          width: 0.08,
          height: 0.08,
        },
        { kind: 'warning_label', semanticRole: 'safety_label' },
      ],
    })

    const result = assessPrimitiveVisualQuality(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: 'factory AGV material cart',
        geometryBrief: { category: 'agv_material_cart' },
      },
    )

    expect(result.family).toBe('industrial_equipment')
    expect(result.score).toBeGreaterThanOrEqual(0.8)
    expect(result.issues).not.toContain(
      'vehicle needs a separate cabin/roof mass, not one plain body block.',
    )
  })
})
