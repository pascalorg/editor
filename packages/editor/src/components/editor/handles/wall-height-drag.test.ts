import { describe, expect, test } from 'bun:test'
import { MIN_WALL_HEIGHT } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Ray, Vector3 } from 'three'
import { createWallHeightDrag } from './wall-height-drag'

function pointerAt(y: number) {
  return new Ray(new Vector3(0, y, 5), new Vector3(0, 0, -1))
}

describe('wall height pointer drag', () => {
  test('controller movement changes height without screen coordinates', () => {
    const resize = createWallHeightDrag({
      initialRay: pointerAt(2.76),
      levelMatrixWorld: new Matrix4(),
      midpoint: new Vector3(),
      initialHeight: 2.5,
    })!
    expect(resize(pointerAt(2.76))).toBeCloseTo(2.5)
    expect(resize(pointerAt(3.76))).toBeCloseTo(3.5)
    expect(resize(pointerAt(1.76))).toBeCloseTo(1.5)
    expect(resize(pointerAt(-10))).toBe(MIN_WALL_HEIGHT)
  })

  test('God-mode scale, rotation and elevated levels preserve local height changes', () => {
    const transform = new Matrix4().compose(
      new Vector3(4, 3, -2),
      new Quaternion().setFromEuler(new Euler(0.2, 0.8, -0.1)),
      new Vector3(0.2, 0.2, 0.2),
    )
    const resize = createWallHeightDrag({
      initialRay: pointerAt(2.76).applyMatrix4(transform),
      levelMatrixWorld: transform,
      midpoint: new Vector3(),
      initialHeight: 2.5,
    })!
    expect(resize(pointerAt(3.76).applyMatrix4(transform))).toBeCloseTo(3.5)
  })

  test('desktop perspective rays resize without an initial jump', () => {
    const origin = new Vector3(4, 5, 8)
    const rayAt = (y: number) => new Ray(origin, new Vector3(0, y, 0).sub(origin).normalize())
    const resize = createWallHeightDrag({
      initialRay: rayAt(2.76),
      levelMatrixWorld: new Matrix4(),
      midpoint: new Vector3(),
      initialHeight: 2.5,
    })!
    expect(resize(rayAt(2.76))).toBeCloseTo(2.5)
    expect(resize(rayAt(3.76))).toBeCloseTo(3.5)
  })

  test('ignores a pointer that no longer intersects the drag plane', () => {
    const resize = createWallHeightDrag({
      initialRay: pointerAt(2.76),
      levelMatrixWorld: new Matrix4(),
      midpoint: new Vector3(),
      initialHeight: 2.5,
    })!
    expect(resize(new Ray(new Vector3(0, 3, 5), new Vector3(1, 0, 0)))).toBeNull()
    expect(resize(pointerAt(3.76))).toBeCloseTo(3.5)
  })
})
