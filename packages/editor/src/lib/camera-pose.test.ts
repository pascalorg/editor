import { describe, expect, test } from 'bun:test'
import {
  normalizeCameraPose,
  planCameraPoseApplication,
  stepCameraPoseInterpolation,
  withCameraPoseDistance,
} from './camera-pose'

describe('camera pose', () => {
  test('normalizes a finite pose without retaining input tuples', () => {
    const position: [number, number, number] = [1, 2, 3]
    const target: [number, number, number] = [4, 5, 6]
    const pose = normalizeCameraPose({
      position,
      target,
      projection: 'perspective',
      fov: 50,
      viewWidth: 12,
    })

    expect(pose).toEqual({
      fov: 50,
      position,
      projection: 'perspective',
      target,
      viewWidth: 12,
    })
    expect(pose?.position).not.toBe(position)
    expect(pose?.target).not.toBe(target)
  })

  test('rejects non-finite, malformed, and unknown camera poses', () => {
    expect(normalizeCameraPose(null)).toBeNull()
    expect(
      normalizeCameraPose({
        position: [1, 2],
        target: [4, 5, 6],
        projection: 'perspective',
      }),
    ).toBeNull()
    expect(
      normalizeCameraPose({
        position: [1, Number.NaN, 3],
        target: [4, 5, 6],
        projection: 'perspective',
      }),
    ).toBeNull()
    expect(
      normalizeCameraPose({
        position: [1, 2, 3],
        target: [4, 5, Number.POSITIVE_INFINITY],
        projection: 'perspective',
      }),
    ).toBeNull()
    expect(
      normalizeCameraPose({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'panoramic',
      }),
    ).toBeNull()
    expect(
      normalizeCameraPose({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'perspective',
        fov: Number.NaN,
      }),
    ).toBeNull()
    expect(
      normalizeCameraPose({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'orthographic',
        viewWidth: 0,
      }),
    ).toBeNull()
    expect(
      normalizeCameraPose({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'orthographic',
        viewWidth: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull()
  })

  test('plans only perspective fov application and clamps it to a safe range', () => {
    expect(
      planCameraPoseApplication({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'perspective',
        fov: 0,
      })?.perspectiveFov,
    ).toBe(1)
    expect(
      planCameraPoseApplication({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'perspective',
        fov: 200,
      })?.perspectiveFov,
    ).toBe(179)
    expect(
      planCameraPoseApplication({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'orthographic',
        fov: 70,
      })?.perspectiveFov,
    ).toBeNull()
  })

  test('interpolates toward the latest pose and converges exactly', () => {
    const destination = {
      position: [12, 6, -4] as [number, number, number],
      target: [2, 1, 3] as [number, number, number],
      projection: 'perspective' as const,
    }
    const first = stepCameraPoseInterpolation([0, 0, 0], [0, 0, 0], destination, 0.016)
    expect(first.settled).toBe(false)
    expect(first.position[0]).toBeGreaterThan(0)
    expect(first.position[0]).toBeLessThan(destination.position[0])

    let position = first.position
    let target = first.target
    let settled = first.settled
    for (let frame = 0; frame < 240 && !settled; frame += 1) {
      const step = stepCameraPoseInterpolation(position, target, destination, 0.016)
      position = step.position
      target = step.target
      settled = step.settled
    }

    expect(settled).toBe(true)
    expect(position).toEqual(destination.position)
    expect(target).toEqual(destination.target)
  })

  test('settles an already-current pose without advancing on an invalid delta', () => {
    const destination = {
      position: [1, 2, 3] as [number, number, number],
      target: [4, 5, 6] as [number, number, number],
      projection: 'orthographic' as const,
    }
    expect(
      stepCameraPoseInterpolation(
        destination.position,
        destination.target,
        destination,
        Number.NaN,
      ),
    ).toEqual({
      position: destination.position,
      settled: true,
      target: destination.target,
    })
    expect(stepCameraPoseInterpolation([0, 0, 0], [0, 0, 0], destination, Number.NaN)).toEqual({
      position: [0, 0, 0],
      settled: false,
      target: [0, 0, 0],
    })
  })

  test('retargets the bounded interpolation owner to the latest pose', () => {
    const first = stepCameraPoseInterpolation(
      [0, 0, 0],
      [0, 0, 0],
      {
        position: [10, 0, 0],
        target: [5, 0, 0],
        projection: 'perspective',
      },
      0.016,
    )
    const retargeted = stepCameraPoseInterpolation(
      first.position,
      first.target,
      {
        position: [-10, 0, 0],
        target: [-5, 0, 0],
        projection: 'perspective',
      },
      0.1,
    )

    expect(retargeted.position[0]).toBeLessThan(first.position[0])
    expect(retargeted.target[0]).toBeLessThan(first.target[0])
  })

  test('preserves view direction while adapting distance to the local viewport', () => {
    const pose = {
      position: [4, 6, 12] as [number, number, number],
      target: [1, 2, 3] as [number, number, number],
      projection: 'perspective' as const,
      viewWidth: 20,
    }
    const adapted = withCameraPoseDistance(pose, 5)
    const sourceDirection = pose.position.map((value, index) => value - pose.target[index]!)
    const adaptedDirection = adapted.position.map((value, index) => value - adapted.target[index]!)
    const sourceLength = Math.hypot(...sourceDirection)

    expect(Math.hypot(...adaptedDirection)).toBeCloseTo(5)
    const expectedDirection = sourceDirection.map((component) => component * (5 / sourceLength))
    expect(adaptedDirection[0]).toBeCloseTo(expectedDirection[0]!)
    expect(adaptedDirection[1]).toBeCloseTo(expectedDirection[1]!)
    expect(adaptedDirection[2]).toBeCloseTo(expectedDirection[2]!)
    expect(adapted.target).toEqual(pose.target)
    expect(adapted.target).not.toBe(pose.target)
    expect(pose.position).toEqual([4, 6, 12])
  })
})
