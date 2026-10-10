import { describe, expect, test } from 'bun:test'
import {
  type Box,
  FOLLOW_DWELL_S,
  FOLLOW_ELEVATION,
  FOLLOW_GATHER_S,
  Follower,
  type FollowWant,
  frameOf,
  mergeWants,
  OrbitSpring,
} from './follow-pascal'

const box = (min: [number, number, number], max: [number, number, number]): Box => ({ min, max })
const want = (kind: FollowWant['kind'], b: Box, at = 0, normal?: [number, number]): FollowWant => ({
  kind,
  box: b,
  at,
  ...(normal ? { normal } : {}),
})
const VIEW = { fov: 45, aspect: 1.6, azimuth: 0.6 }

// Follow Pascal (the owner, 2026-10-08): the camera eases to what the current step is working on,
// at the distance its scale needs; about 1.5 s on each target at least, several things landing
// together framed as one; a level horizon; touching the camera pauses it.
describe('what the camera looks at next', () => {
  test('waits to gather what lands together, and then to dwell on the last target', () => {
    const follower = new Follower()
    follower.want(want('floor', box([0, 0, 0], [10, 3, 8]), 0))
    expect(follower.due(0.1)).toBeNull()
    expect(follower.due(FOLLOW_GATHER_S - 0.01)).toBeNull()
    const first = follower.due(FOLLOW_GATHER_S + 0.01)
    expect(first?.kind).toBe('floor')
    // Nothing is due while it dwells, however much is waiting.
    follower.want(want('detail', box([1, 1, 0], [2, 2, 0.2]), 0.5))
    expect(follower.due(FOLLOW_GATHER_S + 0.9)).toBeNull()
    expect(follower.due(FOLLOW_GATHER_S + 0.01 + FOLLOW_DWELL_S - 0.02)).toBeNull()
    expect(follower.due(FOLLOW_GATHER_S + 0.01 + FOLLOW_DWELL_S + 0.02)?.kind).toBe('detail')
  })

  test('several things landing together are one target: their union', () => {
    const merged = mergeWants([
      want('detail', box([0, 0, 0], [1, 2, 0.2])),
      want('detail', box([4, 0, 0], [5, 2, 0.2])),
      want('detail', box([8, 0, 0], [9, 2, 0.2])),
    ])
    expect(merged.box).toEqual(box([0, 0, 0], [9, 2, 0.2]))
    expect(merged.kind).toBe('detail')
  })

  test('different kinds together are a group', () => {
    expect(
      mergeWants([
        want('detail', box([0, 0, 0], [1, 1, 1])),
        want('roof', box([0, 3, 0], [8, 5, 6])),
      ]).kind,
    ).toBe('group')
  })

  test('a shared direction survives the merge; a mixed one does not', () => {
    const facing = mergeWants([
      want('detail', box([0, 0, 0], [1, 1, 1]), 0, [0, 1]),
      want('detail', box([2, 0, 0], [3, 1, 1]), 0, [0.2, 0.98]),
    ])
    expect(facing.normal?.[1]).toBeGreaterThan(0.9)
    const mixed = mergeWants([
      want('detail', box([0, 0, 0], [1, 1, 1]), 0, [0, 1]),
      want('detail', box([2, 0, 0], [3, 1, 1]), 0, [0, -1]),
    ])
    expect(mixed.normal).toBeUndefined()
  })

  test('a blocked follower (the person is pointing at something) holds what it has', () => {
    const follower = new Follower()
    follower.want(want('floor', box([0, 0, 0], [10, 3, 8]), 0))
    expect(follower.due(5, true)).toBeNull()
    expect(follower.due(5)?.kind).toBe('floor')
  })

  test('a reset forgets what waits and starts its dwell over', () => {
    const follower = new Follower()
    follower.want(want('floor', box([0, 0, 0], [10, 3, 8]), 0))
    follower.due(1)
    follower.want(want('roof', box([0, 3, 0], [10, 5, 8]), 1.2))
    follower.reset()
    expect(follower.due(10)).toBeNull()
    follower.want(want('roof', box([0, 3, 0], [10, 5, 8]), 10))
    expect(follower.due(10.5)?.kind).toBe('roof')
  })
})

describe('how far the camera stands', () => {
  const house = box([0, 0, 0], [12, 3, 8])

  test('a floor is seen whole: the camera stands back until it fits', () => {
    const goal = frameOf(want('floor', house), VIEW)
    expect([goal.x, goal.z]).toEqual([6, 4])
    expect(goal.el).toBe(FOLLOW_ELEVATION.floor)
    // Half of the wide side over the tangent of the narrower half-angle, with room to spare.
    const needed = 6 / Math.tan(Math.atan(Math.tan((45 * Math.PI) / 360) * 1.6) * 1)
    expect(goal.r).toBeGreaterThan(Math.min(needed, 6 / Math.tan((45 * Math.PI) / 360)) * 0.9)
  })

  test('a window is seen close, a floor far, a group in between', () => {
    const window = frameOf(want('detail', box([3, 0.9, -0.1], [4.2, 2.4, 0.1])), VIEW)
    const floor = frameOf(want('floor', house), VIEW)
    const group = frameOf(want('group', box([0, 0, 0], [6, 3, 4])), VIEW)
    expect(window.r).toBeLessThan(floor.r / 2)
    expect(group.r).toBeLessThan(floor.r)
    expect(group.r).toBeGreaterThan(window.r)
    // The sill of a close-up is seen from nearly level; the furniture, from above.
    expect(window.el).toBeLessThan(frameOf(want('furnish', box([1, 0, 1], [2, 1, 2])), VIEW).el)
  })

  test('a narrow window of the screen needs more distance than a wide one', () => {
    const wide = frameOf(want('floor', house), { ...VIEW, aspect: 2 })
    const narrow = frameOf(want('floor', house), { ...VIEW, aspect: 0.8 })
    expect(narrow.r).toBeGreaterThan(wide.r)
  })

  test('what faces a wall is looked at from its outside, on the side nearest the way it already looks', () => {
    const goal = frameOf(want('detail', box([3, 0.9, -0.1], [4.2, 2.4, 0.1]), 0, [0, -1]), {
      ...VIEW,
      azimuth: 0.3,
    })
    // The wall's outside is -z: the eye stands at -z, within half a radian of facing it.
    const toEye = Math.atan2(Math.sin(goal.az), Math.cos(goal.az))
    expect(Math.abs(Math.abs(toEye) - Math.PI)).toBeLessThan(0.6)
  })

  test('the roof is looked at from above its ridge line, the floor from its middle height', () => {
    const roof = frameOf(want('roof', box([0, 3, 0], [12, 5.2, 8])), VIEW)
    expect(roof.y).toBeLessThan(4.1 + 1e-9)
    expect(roof.el).toBeGreaterThan(FOLLOW_ELEVATION.floor)
  })
})

describe('an eye that must clear something', () => {
  const item = box([4, 0, 3], [4.6, 0.9, 3.6])

  test('stands back until it is above what it must clear', () => {
    const plain = frameOf(want('furnish', item), VIEW)
    const high = frameOf({ ...want('furnish', item), eyeAbove: 8 }, VIEW)
    const eyeY = (goal: ReturnType<typeof frameOf>) => goal.y + goal.r * Math.sin(goal.el)
    expect(eyeY(plain)).toBeLessThan(8)
    expect(eyeY(high)).toBeGreaterThanOrEqual(8 - 1e-9)
    expect(high.r).toBeGreaterThan(plain.r)
    // Same place, same direction: only further back.
    expect([high.x, high.y, high.z, high.el]).toEqual([plain.x, plain.y, plain.z, plain.el])
  })

  test('is not pushed back when it is already clear', () => {
    const roomy = box([0, 0, 0], [12, 3, 8])
    const goal = frameOf({ ...want('floor', roomy), eyeAbove: 2 }, VIEW)
    expect(goal.r).toBe(frameOf(want('floor', roomy), VIEW).r)
  })

  test('what lands together keeps the highest it must clear', () => {
    const merged = mergeWants([
      { ...want('furnish', item), eyeAbove: 6 },
      { ...want('furnish', item), eyeAbove: 9 },
      want('furnish', item),
    ])
    expect(merged.eyeAbove).toBe(9)
  })
})

describe('the camera moves like a spring', () => {
  const goalA = { x: 0, y: 1, z: 0, r: 20, az: 0.5, el: 0.5 }
  const goalB = { x: 6, y: 1.2, z: 3, r: 9, az: 1.4, el: 0.3 }

  test('reaches its goal without overshooting any of its six values', () => {
    const spring = new OrbitSpring(goalA)
    spring.to(goalB)
    const worst = { r: Math.min(), az: Math.max(), x: Math.max() }
    for (let t = 0; t < 4; t += 1 / 60) {
      spring.step(1 / 60)
      const now = spring.value()
      worst.r = Math.min(worst.r, now.r)
      worst.az = Math.max(worst.az, now.az)
      worst.x = Math.max(worst.x, now.x)
    }
    expect(worst.r).toBeGreaterThanOrEqual(9 - 1e-6)
    expect(worst.az).toBeLessThanOrEqual(1.4 + 1e-6)
    expect(worst.x).toBeLessThanOrEqual(6 + 1e-6)
    const end = spring.value()
    for (const key of Object.keys(goalB) as (keyof typeof goalB)[])
      expect(end[key]).toBeCloseTo(goalB[key], 3)
  })

  test('goes round the short way, however the angle was written', () => {
    const spring = new OrbitSpring({ ...goalA, az: 3.0 })
    spring.to({ ...goalA, az: -3.0 })
    // -3.0 is 0.28 rad past pi: the way round is 0.28 rad, not 6.
    spring.step(0.05)
    const early = spring.value().az
    expect(Math.abs(early - 3.0)).toBeLessThan(0.3)
    for (let t = 0; t < 4; t += 1 / 60) spring.step(1 / 60)
    const end = spring.value().az
    expect(Math.abs(Math.sin(end - -3.0))).toBeLessThan(1e-3)
  })

  test('a new goal turns it round from where it is, without a jump', () => {
    const spring = new OrbitSpring(goalA)
    spring.to(goalB)
    for (let index = 0; index < 20; index += 1) spring.step(1 / 60)
    const before = spring.value()
    spring.to(goalA)
    spring.step(1 / 600)
    const after = spring.value()
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.05)
    expect(Math.abs(after.r - before.r)).toBeLessThan(0.1)
  })

  test('a pose is the eye at its radius and angles about its centre, level with the horizon', () => {
    const spring = new OrbitSpring({ x: 2, y: 1, z: 3, r: 10, az: 0, el: Math.PI / 6 })
    const pose = spring.pose()
    expect(pose.target).toEqual([2, 1, 3])
    // az 0 looks along -z from +z; the eye is r away, 30 degrees up.
    expect(pose.position[0]).toBeCloseTo(2)
    expect(pose.position[1]).toBeCloseTo(1 + 10 * Math.sin(Math.PI / 6))
    expect(pose.position[2]).toBeCloseTo(3 + 10 * Math.cos(Math.PI / 6))
    expect(pose.projection).toBe('perspective')
  })

  test('it can be set where the camera already is, so following starts from the view the person has', () => {
    const spring = new OrbitSpring(goalA)
    spring.fromPose({ position: [10, 6, 10], target: [0, 1, 0], projection: 'perspective' })
    const value = spring.value()
    expect(value.r).toBeCloseTo(Math.hypot(10, 5, 10))
    expect(value.el).toBeCloseTo(Math.asin(5 / Math.hypot(10, 5, 10)))
    expect(Math.sin(value.az)).toBeCloseTo(10 / Math.hypot(10, 10))
  })
})
