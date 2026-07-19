import { describe, expect, test } from 'bun:test'
import {
  normalizeCameraCollaborationPose,
  planCameraCollaborationPoseApplication,
  stepCameraCollaborationInterpolation,
} from './camera-collaboration'

describe('camera collaboration pose', () => {
  test('normalizes a finite pose without retaining input tuples', () => {
    const position: [number, number, number] = [1, 2, 3]
    const target: [number, number, number] = [4, 5, 6]
    const pose = normalizeCameraCollaborationPose({
      position,
      target,
      projection: 'perspective',
      fov: 50,
      viewWidth: 12,
      aspect: 16 / 9,
    })

    expect(pose).toEqual({
      aspect: 16 / 9,
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
    expect(normalizeCameraCollaborationPose(null)).toBeNull()
    expect(
      normalizeCameraCollaborationPose({
        position: [1, 2],
        target: [4, 5, 6],
        projection: 'perspective',
      }),
    ).toBeNull()
    expect(
      normalizeCameraCollaborationPose({
        position: [1, Number.NaN, 3],
        target: [4, 5, 6],
        projection: 'perspective',
      }),
    ).toBeNull()
    expect(
      normalizeCameraCollaborationPose({
        position: [1, 2, 3],
        target: [4, 5, Number.POSITIVE_INFINITY],
        projection: 'perspective',
      }),
    ).toBeNull()
    expect(
      normalizeCameraCollaborationPose({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'panoramic',
      }),
    ).toBeNull()
    expect(
      normalizeCameraCollaborationPose({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'perspective',
        fov: Number.NaN,
      }),
    ).toBeNull()
    expect(
      normalizeCameraCollaborationPose({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'orthographic',
        viewWidth: 0,
      }),
    ).toBeNull()
    expect(
      normalizeCameraCollaborationPose({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'orthographic',
        aspect: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull()
  })

  test('plans only perspective fov application and clamps it to a safe range', () => {
    expect(
      planCameraCollaborationPoseApplication({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'perspective',
        fov: 0,
      })?.perspectiveFov,
    ).toBe(1)
    expect(
      planCameraCollaborationPoseApplication({
        position: [1, 2, 3],
        target: [4, 5, 6],
        projection: 'perspective',
        fov: 200,
      })?.perspectiveFov,
    ).toBe(179)
    expect(
      planCameraCollaborationPoseApplication({
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
    const first = stepCameraCollaborationInterpolation([0, 0, 0], [0, 0, 0], destination, 0.016)
    expect(first.settled).toBe(false)
    expect(first.position[0]).toBeGreaterThan(0)
    expect(first.position[0]).toBeLessThan(destination.position[0])

    let position = first.position
    let target = first.target
    let settled = first.settled
    for (let frame = 0; frame < 240 && !settled; frame += 1) {
      const step = stepCameraCollaborationInterpolation(position, target, destination, 0.016)
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
      stepCameraCollaborationInterpolation(
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
    expect(
      stepCameraCollaborationInterpolation([0, 0, 0], [0, 0, 0], destination, Number.NaN),
    ).toEqual({ position: [0, 0, 0], settled: false, target: [0, 0, 0] })
  })

  test('retargets the bounded interpolation owner to the latest pose', () => {
    const first = stepCameraCollaborationInterpolation(
      [0, 0, 0],
      [0, 0, 0],
      {
        position: [10, 0, 0],
        target: [5, 0, 0],
        projection: 'perspective',
      },
      0.016,
    )
    const retargeted = stepCameraCollaborationInterpolation(
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
})
