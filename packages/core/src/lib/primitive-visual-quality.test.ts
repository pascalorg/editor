import { describe, expect, test } from 'bun:test'
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
    expect(result.issues).toContain('vehicle needs a separate cabin/roof mass, not one plain body block.')
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
})
