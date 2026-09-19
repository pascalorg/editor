// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { Object3D, Vector3 } from 'three'
import {
  applyGodScaleGesture,
  resetGodScaleRoot,
  resolveGodScalePan,
  resolveGodScaleTransform,
} from './scale-interaction'

describe('God-scale live gesture lifecycle', () => {
  test('pans the scene root with a single grip', () => {
    const root = new Object3D()
    const gesture = { mode: null }
    const leftPosition = new Vector3(0, 1, 0)
    const rightPosition = new Vector3()

    applyGodScaleGesture({ root, gesture, mode: 'left', leftPosition, rightPosition })
    leftPosition.set(0.1, 1, 0)
    applyGodScaleGesture({ root, gesture, mode: 'left', leftPosition, rightPosition })

    expect(root.position.x).toBeCloseTo(0.3)
  })

  test('scales and rotates the scene root with two grips', () => {
    const root = new Object3D()
    const gesture = { mode: null }
    const leftPosition = new Vector3(-1, 0, 0)
    const rightPosition = new Vector3(1, 0, 0)

    applyGodScaleGesture({ root, gesture, mode: 'two', leftPosition, rightPosition })
    leftPosition.set(0, 0, -2)
    rightPosition.set(0, 0, 2)
    applyGodScaleGesture({ root, gesture, mode: 'two', leftPosition, rightPosition })

    expect(root.scale.x).toBe(2)
    expect(root.rotation.y).toBeCloseTo(-Math.PI / 2)
  })

  test('resets the scene root and cancels the active gesture', () => {
    const root = new Object3D()
    const gesture = { mode: 'two' as const }
    root.position.set(4, -2, 7)
    root.rotation.set(0.2, 1.1, -0.4)
    root.scale.setScalar(3)

    resetGodScaleRoot(root, gesture)

    expect(root.position.toArray()).toEqual([0, 0, 0])
    expect(root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0])
    expect(root.scale.toArray()).toEqual([1, 1, 1])
    expect(gesture.mode).toBeNull()
  })
})

describe('God-scale transform math', () => {
  test('pans by the movement of one grip', () => {
    const result = resolveGodScalePan(
      new Vector3(2, 0, -1),
      new Vector3(0, 1, 0),
      new Vector3(0.5, 1.25, -0.25),
    )
    expect(result.toArray()).toEqual([2.5, 0.25, -1.25])
  })

  test('scales around the two-grip midpoint and follows midpoint movement', () => {
    const result = resolveGodScaleTransform({
      rootPosition: new Vector3(),
      rootScale: 1,
      startLeft: new Vector3(-1, 0, 0),
      startRight: new Vector3(1, 0, 0),
      currentLeft: new Vector3(-1.5, 0, 1),
      currentRight: new Vector3(2.5, 0, 1),
    })

    expect(result.scale).toBe(2)
    expect(result.position.toArray()).toEqual([0.5, 0, 1])
    expect(result.rotationY).toBe(0)
  })

  test('keeps scaling above the original maximum', () => {
    const result = resolveGodScaleTransform({
      rootPosition: new Vector3(1, 0, 0),
      rootScale: 10,
      startLeft: new Vector3(-1, 0, 0),
      startRight: new Vector3(1, 0, 0),
      currentLeft: new Vector3(-4, 0, 0),
      currentRight: new Vector3(4, 0, 0),
    })

    expect(result.scale).toBe(40)
    expect(result.position.toArray()).toEqual([4, 0, 0])
  })

  test('stops at the minimum scale while keeping the midpoint anchored', () => {
    const result = resolveGodScaleTransform({
      rootPosition: new Vector3(2, 0, 0),
      rootScale: 0.1,
      startLeft: new Vector3(-1, 0, 0),
      startRight: new Vector3(1, 0, 0),
      currentLeft: new Vector3(-0.1, 0, 0),
      currentRight: new Vector3(0.1, 0, 0),
    })

    expect(result.scale).toBe(0.05)
    expect(result.position.toArray()).toEqual([1, 0, 0])
  })
})
