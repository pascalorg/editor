import { describe, expect, test } from 'bun:test'
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
    })
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
