import { describe, expect, test } from 'bun:test'
import { composePartPrimitives } from './part-compose'
import type { PrimitiveShapeInput } from './primitive-compose'
import { resolvePrimitiveWorldTransforms } from './primitive-compose'
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
    expect(result.facts.roles.vehicle_window).toBe(4)
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
    expect(result.issues).toContain('vehicle requires exactly 4 tires arranged as two axles, got 2.')
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
          requiredRoles: ['bicycle_wheels', 'frame', 'fork', 'handlebar', 'saddle', 'chain'],
        },
      },
    )

    expect(result.ok).toBe(true)
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
})
