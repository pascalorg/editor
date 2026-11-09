import { describe, expect, test } from 'bun:test'
import { CameraControlsImpl } from '@react-three/drei'
import * as THREE from 'three'
import {
  computeFitSceneLookAt,
  type PendingFitScene,
  planFitSceneOnEvent,
  planFitSceneOnOrbitResume,
} from './fit-scene-framing'

const sampleBounds = {
  center: [10, 20] as [number, number],
  size: [30, 40] as [number, number],
}

describe('fit-scene framing', () => {
  test('computes default look-at when bounds are null', () => {
    expect(computeFitSceneLookAt(null)).toEqual({
      eyeX: 20,
      eyeY: 20,
      eyeZ: 20,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      eyeHeight: 20,
      fitSphere: { center: [0, 0, 0], radius: 15 },
    })
  })

  test('computes orbit look-at from scene bounds', () => {
    const lookAt = computeFitSceneLookAt(sampleBounds)
    // Longer extent is depth=40 → distance=56, height=32
    expect(lookAt).toEqual({
      eyeX: 10 + 56 * 0.7,
      eyeY: 32,
      eyeZ: 20 + 56 * 0.7,
      targetX: 10,
      targetY: 0,
      targetZ: 20,
      eyeHeight: 32,
      fitSphere: { center: [10, 0, 20], radius: 25 * 1.3 },
    })
  })

  test('rests the pivot and lifts the eye by the level ground height', () => {
    const lookAt = computeFitSceneLookAt(sampleBounds, 3)
    expect(lookAt.targetY).toBe(3)
    expect(lookAt.eyeY).toBe(35)
    expect(lookAt.eyeHeight).toBe(32)
    expect(computeFitSceneLookAt(null, 3)).toMatchObject({ eyeY: 23, targetY: 3 })
  })

  test('fits the orthographic sphere around the footprint at the pivot', () => {
    const lookAt = computeFitSceneLookAt(sampleBounds, 3)
    expect(lookAt.fitSphere.center).toEqual([lookAt.targetX, lookAt.targetY, lookAt.targetZ])
    const [cx, cz] = sampleBounds.center
    const [w, d] = sampleBounds.size
    for (const [x, z] of [
      [cx - w / 2, cz - d / 2],
      [cx + w / 2, cz + d / 2],
      [cx - w / 2, cz + d / 2],
    ] as const) {
      expect(Math.hypot(x - cx, z - cz)).toBeLessThan(lookAt.fitSphere.radius)
    }
    const lone = computeFitSceneLookAt({ center: [0, 0], size: [1, 0.2] })
    expect(lone.fitSphere.radius).toBe(5)
    expect(computeFitSceneLookAt(null, 3).fitSphere).toEqual({ center: [0, 3, 0], radius: 15 })
  })

  test('an orthographic camera fitted to the sphere shows the whole footprint whatever its zoom was', () => {
    const previous = globalThis.DOMRect
    globalThis.DOMRect ??= class {} as typeof DOMRect
    CameraControlsImpl.install({ THREE })
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 1000)
    const control = new CameraControlsImpl(camera)
    const bounds = { center: [60, -20] as [number, number], size: [80, 30] as [number, number] }
    try {
      // The previous project left the camera zoomed in on a small room.
      control.zoomTo(12, false)
      const lookAt = computeFitSceneLookAt(bounds)
      control.setLookAt(
        lookAt.eyeX,
        lookAt.eyeY,
        lookAt.eyeZ,
        lookAt.targetX,
        lookAt.targetY,
        lookAt.targetZ,
        false,
      )
      const sphere = new THREE.Sphere(
        new THREE.Vector3(...lookAt.fitSphere.center),
        lookAt.fitSphere.radius,
      )
      control.fitToSphere(sphere, false)
      control.update(0)
      camera.updateMatrixWorld(true)

      const target = control.getTarget(new THREE.Vector3())
      expect(target.toArray()).toEqual([lookAt.targetX, lookAt.targetY, lookAt.targetZ])
      const [cx, cz] = bounds.center
      const [w, d] = bounds.size
      for (const x of [cx - w / 2, cx + w / 2])
        for (const z of [cz - d / 2, cz + d / 2]) {
          const projected = new THREE.Vector3(x, 0, z).project(camera)
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(1)
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(1)
        }
    } finally {
      control.dispose()
      globalThis.DOMRect = previous
    }
  })

  test('applies immediately when orbit controls are live', () => {
    const plan = planFitSceneOnEvent({
      isPreviewMode: false,
      isFirstPersonMode: false,
      hasControls: true,
      bounds: sampleBounds,
    })

    expect(plan).toEqual({
      action: 'apply',
      lookAt: computeFitSceneLookAt(sampleBounds),
    })
  })

  test('ignores fit-scene while preview mode is active', () => {
    const plan = planFitSceneOnEvent({
      isPreviewMode: true,
      isFirstPersonMode: false,
      hasControls: true,
      bounds: sampleBounds,
    })
    expect(plan).toEqual({ action: 'ignore' })
  })

  test('queues fit-scene while first-person is active (scene-ready during FP)', () => {
    const plan = planFitSceneOnEvent({
      isPreviewMode: false,
      isFirstPersonMode: true,
      hasControls: false,
      bounds: sampleBounds,
    })

    expect(plan).toEqual({
      action: 'queue',
      pending: { bounds: sampleBounds },
    })
  })

  test('queues fit-scene when orbit controls are not mounted yet', () => {
    const plan = planFitSceneOnEvent({
      isPreviewMode: false,
      isFirstPersonMode: false,
      hasControls: false,
      bounds: sampleBounds,
    })

    expect(plan).toEqual({
      action: 'queue',
      pending: { bounds: sampleBounds },
    })
  })

  test('scene-ready during first-person then return to orbit applies the pending frame', () => {
    // Mirrors the blocking lifecycle: fit arrives while FP is active, then
    // orbit remounts and the queued frame must still apply.
    let pending: PendingFitScene | null = null

    const duringFirstPerson = planFitSceneOnEvent({
      isPreviewMode: false,
      isFirstPersonMode: true,
      hasControls: false,
      bounds: sampleBounds,
    })
    expect(duringFirstPerson.action).toBe('queue')
    if (duringFirstPerson.action === 'queue') {
      pending = duringFirstPerson.pending
    }

    // Still in first-person: controls are not ready, keep the pending frame.
    expect(
      planFitSceneOnOrbitResume({
        isPreviewMode: false,
        isFirstPersonMode: true,
        hasControls: false,
        pending,
      }),
    ).toEqual({ action: 'noop' })

    // Leave first-person; orbit controls remount and can apply the frame.
    const afterOrbitResume = planFitSceneOnOrbitResume({
      isPreviewMode: false,
      isFirstPersonMode: false,
      hasControls: true,
      pending,
    })

    expect(afterOrbitResume).toEqual({
      action: 'apply',
      lookAt: computeFitSceneLookAt(sampleBounds),
    })
  })

  test('latest fit-scene while first-person wins when orbit resumes', () => {
    let pending: PendingFitScene | null = null
    const first = planFitSceneOnEvent({
      isPreviewMode: false,
      isFirstPersonMode: true,
      hasControls: false,
      bounds: null,
    })
    if (first.action === 'queue') pending = first.pending

    const secondBounds = {
      center: [0, 0] as [number, number],
      size: [10, 10] as [number, number],
    }
    const second = planFitSceneOnEvent({
      isPreviewMode: false,
      isFirstPersonMode: true,
      hasControls: false,
      bounds: secondBounds,
    })
    if (second.action === 'queue') pending = second.pending

    expect(
      planFitSceneOnOrbitResume({
        isPreviewMode: false,
        isFirstPersonMode: false,
        hasControls: true,
        pending,
      }),
    ).toEqual({
      action: 'apply',
      lookAt: computeFitSceneLookAt(secondBounds),
    })
  })

  test('does not flush a pending frame into preview mode', () => {
    expect(
      planFitSceneOnOrbitResume({
        isPreviewMode: true,
        isFirstPersonMode: false,
        hasControls: true,
        pending: { bounds: sampleBounds },
      }),
    ).toEqual({ action: 'noop' })
  })
})
