import { describe, expect, test } from 'bun:test'
import { Group } from 'three'
import {
  applyFaceHostPreviewPose,
  clampFaceHostCenterPosition,
  clampFaceHostPosition,
  resolveFaceHostSwitch,
  shouldDetachFaceHostOnLeave,
} from './face-host-preview'

describe('applyFaceHostPreviewPose', () => {
  test('moves the rendered draft synchronously with the pointer result', () => {
    const mesh = new Group()
    mesh.position.set(8, 8, 8)
    mesh.rotation.set(1, 1, 1)

    applyFaceHostPreviewPose(mesh, [1.25, -0.5, 0], [0, 0, 0])

    expect(mesh.position.toArray()).toEqual([1.25, -0.5, 0])
    expect(mesh.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0])
  })
})

describe('resolveFaceHostSwitch', () => {
  test('ignores a single adjacent-face hit and accepts a repeated hit', () => {
    const first = resolveFaceHostSwitch('face-a', 'face-b', null)
    expect(first).toEqual({ accept: false, pendingFaceId: 'face-b' })

    const second = resolveFaceHostSwitch('face-a', 'face-b', first.pendingFaceId)
    expect(second).toEqual({ accept: true, pendingFaceId: null })
  })

  test('clears a pending switch when the pointer returns to the current face', () => {
    expect(resolveFaceHostSwitch('face-a', 'face-a', 'face-b')).toEqual({
      accept: true,
      pendingFaceId: null,
    })
  })
})

describe('shouldDetachFaceHostOnLeave', () => {
  test('detaches attached items when they leave a block face', () => {
    expect(shouldDetachFaceHostOnLeave('wall')).toBe(true)
    expect(shouldDetachFaceHostOnLeave('wall-side')).toBe(true)
    expect(shouldDetachFaceHostOnLeave('ceiling')).toBe(true)
  })

  test('allows free floor items to leave a block face', () => {
    expect(shouldDetachFaceHostOnLeave(undefined)).toBe(true)
  })
})

describe('clampFaceHostPosition', () => {
  test('keeps the complete wall item inside the face after snapping', () => {
    expect(
      clampFaceHostPosition([1.9, 2.8, 0], { minU: -2, maxU: 2, minV: 0, maxV: 3 }, [1, 1]),
    ).toEqual([1.5, 2, 0])
  })

  test('rejects a face that is smaller than the item', () => {
    expect(
      clampFaceHostPosition([0, 0, 0], { minU: -0.25, maxU: 0.25, minV: 0, maxV: 0.5 }, [1, 1]),
    ).toBeNull()
  })
})

describe('clampFaceHostCenterPosition', () => {
  test('keeps a ceiling fixture footprint inside the face on both axes', () => {
    expect(
      clampFaceHostCenterPosition(
        [1.9, 1.9, 0.25],
        { minU: -2, maxU: 2, minV: -2, maxV: 2 },
        [1, 1],
      ),
    ).toEqual([1.5, 1.5, 0.25])
  })
})
