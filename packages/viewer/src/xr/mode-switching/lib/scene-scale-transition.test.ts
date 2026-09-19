// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { Object3D, Vector3 } from 'three'
import {
  captureGodSceneTransform,
  resetSceneForHumanScale,
  resolveXRHumanOriginTarget,
  restoreGodSceneTransform,
} from './scene-scale-transition'

describe('God and Human scene transition', () => {
  test('restores the God transform after world-scale Human mode', () => {
    const root = new Object3D()
    root.position.set(2, 3, 4)
    root.rotation.set(0, 0.5, 0)
    root.scale.setScalar(2)
    const transform = captureGodSceneTransform(root)

    resetSceneForHumanScale(root)
    expect(root.position.toArray()).toEqual([0, 0, 0])
    expect(root.scale.toArray()).toEqual([1, 1, 1])

    expect(restoreGodSceneTransform(root, transform)).toBe(true)
    expect(root.position.toArray()).toEqual([2, 3, 4])
    expect(root.rotation.y).toBeCloseTo(0.5)
    expect(root.scale.toArray()).toEqual([2, 2, 2])
  })

  test('places the tracked viewer over the selected Human point', () => {
    const target = resolveXRHumanOriginTarget(new Vector3(4, 0, -2), new Vector3(0.25, 1.65, -0.5))
    expect(target.toArray()).toEqual([3.75, 0, -1.5])
  })
})
