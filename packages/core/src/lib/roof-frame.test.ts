import { describe, expect, test } from 'bun:test'
import { RoofNode, RoofSegmentNode, roofSegmentFrame } from '../index'

function close(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, 10)
  })
}

// Two quarter turns give independently calculable coordinates; a round trip alone
// would accept two mutually inverse but incorrectly ordered frame transforms.
describe('roof segment physical frame', () => {
  test('composes segment then roof translation and yaw in parent-level coordinates', () => {
    const roof = RoofNode.parse({ position: [10, 7, 20], rotation: Math.PI / 2 })
    const segment = RoofSegmentNode.parse({ position: [2, 3, 4], rotation: Math.PI / 2 })
    const before = structuredClone({ roof, segment })
    const frame = roofSegmentFrame(roof, segment)
    close(frame.toPlan([1, 2]), [13, 16])
    close(frame.toLocal([13, 16]), [1, 2])
    close(frame.localToLevel([1, 5, 2]), [13, 15, 16])
    close(frame.levelToLocal([13, 15, 16]), [1, 5, 2])
    close(frame.localToLevel([0, 0, 0]), [14, 10, 18])
    expect({ roof, segment }).toEqual(before)
  })

  test('normal conversion rotates without translating and preserves unit length', () => {
    const frame = roofSegmentFrame(
      { position: [10, 7, 20], rotation: Math.PI / 2 },
      { position: [2, 3, 4], rotation: Math.PI / 2 },
    )
    const length = Math.sqrt(14)
    const normal = frame.normalToLevel([1 / length, 2 / length, 3 / length])
    close(normal, [-1 / length, 2 / length, -3 / length])
    expect(Math.hypot(...normal)).toBeCloseTo(1, 10)
    close(frame.normalToLevel([0, 1, 0]), [0, 1, 0])
  })

  test('uses the native clockwise-positive XZ convention for either owner independently', () => {
    const identity = { position: [0, 0, 0] as [number, number, number], rotation: 0 }
    for (const [roof, segment] of [
      [identity, { ...identity, rotation: Math.PI / 2 }],
      [{ ...identity, rotation: Math.PI / 2 }, identity],
    ]) {
      const frame = roofSegmentFrame(roof!, segment!)
      close(frame.toPlan([2, 3]), [3, -2])
      close(frame.toLocal([3, -2]), [2, 3])
      close(frame.normalToLevel([1, 0, 0]), [0, 0, -1])
    }
  })

  test('treats curved-shed coordinates as already physical, without bending or unbending them', () => {
    const roof = RoofNode.parse({ position: [10, 7, 20] })
    const segment = RoofSegmentNode.parse({
      roofType: 'shed',
      position: [2, 3, 4],
      arc: { centerX: 0, centerZ: 10, radius: 10 },
    })
    const frame = roofSegmentFrame(roof, segment)
    close(frame.localToLevel([6, 1, 2]), [18, 11, 26])
    close(frame.levelToLocal([18, 11, 26]), [6, 1, 2])
  })
})
