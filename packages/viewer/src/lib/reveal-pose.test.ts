import { describe, expect, test } from 'bun:test'
import type { RevealStyle } from '@pascal-app/core'
import { Matrix4, Object3D, Vector3 } from 'three'
import {
  clearRevealPose,
  RETRACT_LIFT_MAX,
  RETRACT_LIFT_MIN,
  retractPoseAt,
  revealPoseAt,
  setGlidePose,
  setRevealPose,
} from './reveal-pose'

const STYLES: RevealStyle[] = ['rise', 'scale', 'settle', 'drop', 'cut', 'assemble']

function samples(
  style: RevealStyle,
  height: number,
  steps = 200,
  options?: Parameters<typeof revealPoseAt>[4],
) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps
    const { lift, scale } = revealPoseAt(style, t, height, undefined, options)
    return { t, lift, scale: scale.clone() }
  })
}

describe('reveal poses', () => {
  test('every style ends exactly at the rest pose', () => {
    for (const style of STYLES) {
      for (const t of [1, 1.4]) {
        const { lift, scale } = revealPoseAt(style, t, 4)
        expect({ style, lift, scale: scale.toArray() }).toEqual({
          style,
          lift: 0,
          scale: [1, 1, 1],
        })
      }
    }
  })

  // Victor run 12, the user: "it could just scale in normal so it seems carved out of the wall".
  test('cut keeps its width and height and grows through the wall, without overshoot', () => {
    const path = samples('cut', 0)
    expect(path[0]!.scale.z).toBeLessThan(0.01)
    for (const [index, { lift, scale }] of path.entries()) {
      expect(lift).toBe(0)
      expect(scale.x).toBe(1)
      expect(scale.y).toBe(1)
      expect(scale.z).toBeLessThanOrEqual(1)
      if (index > 0) expect(scale.z).toBeGreaterThanOrEqual(path[index - 1]!.scale.z)
    }
  })

  test('assemble holds its node still: its parts carry the motion', () => {
    for (const { lift, scale } of samples('assemble', 4)) {
      expect(lift).toBe(0)
      expect(scale.toArray()).toEqual([1, 1, 1])
    }
  })
})

describe('a posed root', () => {
  test('lifts straight up in its parent frame and never writes its own transform', () => {
    const object = new Object3D()
    object.position.set(1, 2.5, 3)
    object.rotation.set(0, 0.7, 0)
    object.scale.set(1.5, 2, 0.5)
    const own = () => new Matrix4().compose(object.position, object.quaternion, object.scale)

    setRevealPose(object, new Vector3(0.2, 0, 0.1), new Vector3(1, 1, 1), 0.7)
    object.updateMatrix()
    expect(object.position.toArray()).toEqual([1, 2.5, 3])
    // A non-uniform scale on the root does not stretch the fall.
    expect(object.matrix.elements[13]).toBeCloseTo(2.5 + 0.7)
    expect(object.matrix.elements[12]).toBeCloseTo(1)
    expect(object.matrix.elements[14]).toBeCloseTo(3)

    // A floor lift on position.y moves the posed root too.
    object.position.y = 4
    object.updateMatrix()
    expect(object.matrix.elements[13]).toBeCloseTo(4.7)

    clearRevealPose(object)
    expect(object.matrix.equals(own())).toBe(true)
    expect(object.position.y).toBe(4)
  })
})

describe('the build in reverse', () => {
  const trace = (style: RevealStyle, height: number, steps = 100) =>
    Array.from({ length: steps + 1 }, (_, index) => {
      const sample = retractPoseAt(style, index / steps, height)
      return {
        p: index / steps,
        lift: sample.lift,
        scale: sample.scale.clone(),
        opacity: sample.opacity,
      }
    })

  test('every style begins exactly at the rest pose and ends gone', () => {
    for (const style of STYLES) {
      const first = retractPoseAt(style, 0, 2)
      expect({
        style,
        lift: first.lift,
        scale: first.scale.toArray(),
        opacity: first.opacity,
      }).toEqual({
        style,
        lift: 0,
        scale: [1, 1, 1],
        opacity: 1,
      })
      const last = retractPoseAt(style, 1, 2)
      expect(Math.min(...last.scale.toArray())).toBeLessThan(0.01)
      expect(last.opacity).toBe(0)
    }
  })

  test('a wall sinks into the ground: its base stays, and it goes faster as it goes', () => {
    const steps = trace('rise', 0)
    for (const { scale, lift } of steps) {
      expect(scale.x).toBe(1)
      expect(lift).toBe(0)
    }
    const heights = steps.map(({ scale }) => scale.y)
    for (let index = 1; index < heights.length; index += 1)
      expect(heights[index]!).toBeLessThanOrEqual(heights[index - 1]! + 1e-9)
    // It does not hang about at the start: a tenth of the way, it has already moved.
    expect(heights[10]!).toBeLessThan(0.995)
    // And it goes faster as it goes: the last fifth takes more than the first.
    expect(heights[80]! - heights[99]!).toBeGreaterThan((heights[0]! - heights[20]!) * 3)
  })

  test('a piece that fell in lifts away and fades, never sinking', () => {
    for (const style of ['drop', 'settle', 'assemble'] as const) {
      const steps = trace(style, 4)
      let before = -1
      for (const { lift, opacity } of steps) {
        expect(lift).toBeGreaterThanOrEqual(before)
        expect(opacity).toBeGreaterThanOrEqual(0)
        before = lift
      }
      expect(steps.at(-1)!.lift).toBeLessThanOrEqual(RETRACT_LIFT_MAX + 1e-9)
      // A tall piece goes up a good way, but not the whole height it fell from.
      expect(steps.at(-1)!.lift).toBeGreaterThan(RETRACT_LIFT_MIN)
      // It is mostly faded by the time it has risen: the eye follows it up, then it is gone.
      expect(steps[70]!.opacity).toBeLessThan(0.4)
      // It leaves quickly: most of the way up in the first half.
      expect(steps[50]!.lift).toBeGreaterThan(steps.at(-1)!.lift * 0.7)
    }
  })

  test('an opening closes through its wall only', () => {
    const last = retractPoseAt('cut', 0.9, 0)
    expect(last.scale.x).toBe(1)
    expect(last.scale.y).toBe(1)
    expect(last.scale.z).toBeLessThan(0.3)
  })
})

describe('a piece gliding from where it was', () => {
  const placed = () => {
    const piece = new Object3D()
    piece.position.set(2, 0.5, 1)
    piece.rotation.y = 0.5
    return piece
  }
  const composed = (piece: Object3D) => {
    piece.updateMatrix()
    return piece.matrix.clone()
  }

  test('starts exactly where it was, turned as it was, and ends exactly at its own transform', () => {
    const piece = placed()
    const own = composed(piece)
    setGlidePose(piece, new Vector3(-1, 0.5, 4), -0.7, 1)
    const start = composed(piece)
    // Its origin is at the old place, and it faces the old way.
    expect(new Vector3().setFromMatrixPosition(start).toArray()).toEqual(
      [-1, 0.5, 4].map((value) => expect.closeTo(value, 6)),
    )
    expect(Math.atan2(start.elements[8]!, start.elements[0]!)).toBeCloseTo(-0.7, 6)
    setGlidePose(piece, new Vector3(-1, 0.5, 4), -0.7, 0)
    expect(composed(piece).equals(own)).toBe(true)
    clearRevealPose(piece)
    expect(composed(piece).equals(own)).toBe(true)
  })

  test('follows the piece wherever the renderer has put it, and goes between by the share left', () => {
    const piece = new Object3D()
    setGlidePose(piece, new Vector3(0, 0, 0), 0, 0.5)
    // The renderer has not moved it yet: it is where it was.
    expect(new Vector3().setFromMatrixPosition(composed(piece)).toArray()).toEqual([0, 0, 0])
    piece.position.set(4, 0, 2)
    const half = new Vector3().setFromMatrixPosition(composed(piece))
    expect(half.toArray()).toEqual([2, 0, 1])
  })

  test("hops a little on the way, in the parent's up, and turns the short way round", () => {
    const piece = new Object3D()
    piece.rotation.y = -3
    setGlidePose(piece, new Vector3(0, 0, 0), 3, 1, 0.05)
    const matrix = composed(piece)
    expect(matrix.elements[13]).toBeCloseTo(0.05, 6)
    // From 3 to -3 radians is 0.28 the short way, not 6: half way it faces about backwards.
    expect(Math.atan2(matrix.elements[8]!, matrix.elements[0]!)).toBeCloseTo(3, 5)
    setGlidePose(piece, new Vector3(0, 0, 0), 3, 0.5, 0.05)
    const half = composed(piece)
    expect(Math.abs(Math.atan2(half.elements[8]!, half.elements[0]!))).toBeCloseTo(Math.PI, 2)
  })
})
