import { describe, expect, test } from 'bun:test'
import type { Member } from '../core/types'
import {
  framePose,
  levelToWorld,
  matchesHighlight,
  membersBounds,
  serviceHighlight,
} from './highlight'

const member = (over: Partial<Member>): Member => ({
  system: 'wall-framing',
  role: 'stud',
  size: '2x6',
  dims: [0.04, 2.4, 0.14],
  length: 2.4,
  position: [1, 1.2, 0],
  rotation: [0, 0, 0],
  material: 'lumber',
  sourceId: 'w1',
  ...over,
})

describe('the panel highlight — the member set a row / point / selection names (2026-09-09)', () => {
  test('matches by system, size, role and source id (exact or prefix), and nothing without a spec', () => {
    const stud = member({})
    const plate = member({ role: 'top-plate', size: '2x4' })
    const wh = member({ system: 'plumbing', role: 'water-heater', sourceId: 'wh', size: undefined })
    const pan = member({
      system: 'plumbing',
      role: 'equipment',
      sourceId: 'wh-pan',
      size: undefined,
    })
    const whatever = member({
      system: 'plumbing',
      role: 'equipment',
      sourceId: 'whatever',
      size: undefined,
    })
    expect(matchesHighlight(stud, null)).toBe(false)
    expect(matchesHighlight(stud, { label: 'x', systems: ['wall-framing'] })).toBe(true)
    expect(matchesHighlight(wh, { label: 'x', systems: ['wall-framing'] })).toBe(false)
    expect(matchesHighlight(stud, { label: 'x', systems: ['wall-framing'], sizes: ['2x6'] })).toBe(
      true,
    )
    expect(matchesHighlight(plate, { label: 'x', systems: ['wall-framing'], sizes: ['2x6'] })).toBe(
      false,
    )
    expect(matchesHighlight(plate, { label: 'x', roles: ['top-plate'] })).toBe(true)
    expect(matchesHighlight(stud, { label: 'x', sourceIds: ['w1'] })).toBe(true)
    expect(matchesHighlight(wh, { label: 'x', sourceIdPrefixes: ['wh'] })).toBe(true)
    expect(matchesHighlight(pan, { label: 'x', sourceIdPrefixes: ['wh'] })).toBe(true)
    expect(matchesHighlight(whatever, { label: 'x', sourceIdPrefixes: ['wh'] })).toBe(false)
  })
  test('the bounds wrap every member; the pose looks at their centre from a raised diagonal, in the world', () => {
    const a = member({ position: [0, 1, 0], dims: [0.1, 2, 0.1] })
    const b = member({ position: [4, 1, 3], dims: [0.1, 2, 0.1] })
    const bounds = membersBounds([a, b])!
    expect(bounds.min[0]).toBeCloseTo(-0.05, 6)
    expect(bounds.max[0]).toBeCloseTo(4.05, 6)
    expect(bounds.min[1]).toBeCloseTo(0, 6)
    expect(bounds.max[1]).toBeCloseTo(2, 6)
    expect(membersBounds([])).toBeNull()
    const toWorld = levelToWorld(
      {
        lvl: { id: 'lvl', type: 'level', parentId: 'bld', baseElevation: 0.5 },
        bld: {
          id: 'bld',
          type: 'building',
          position: [10, 0.2, -5],
          rotation: [0, Math.PI / 2, 0],
        },
      },
      'lvl',
    )
    // the level's +x turns to the world's -z under a +90° yaw (world = building + R(yaw)·local)
    const w = toWorld([1, 0, 0])
    expect(w[0]).toBeCloseTo(10, 6)
    expect(w[2]).toBeCloseTo(-6, 6)
    expect(toWorld([0, 1, 0])[1]).toBeCloseTo(0.2 + 0.5 + 1, 6)
    const pose = framePose(bounds, toWorld)
    const centreW = toWorld([2, 1, 1.5])
    expect(pose.target).toEqual(centreW)
    // toward the house: the eye stands on the side of the members the house centre is on
    const inward = framePose(bounds, (p) => [p[0], p[1], p[2]], [-10, 1.5])
    expect(inward.position[0]).toBeLessThan(2)
    expect(Math.abs(inward.position[2] - 1.5)).toBeLessThan(0.01)
    // the eye stands off the target and above it
    expect(
      Math.hypot(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2]),
    ).toBeGreaterThan(2)
    expect(pose.position[1]).toBeGreaterThan(pose.target[1])
  })
  test('a placed service point names its engine members', () => {
    expect(serviceHighlight('water-heater')).toEqual({ sourceIdPrefixes: ['wh'] })
    expect(serviceHighlight('utility-pole')).toEqual({ sourceIdPrefixes: ['service-entrance'] })
    expect(serviceHighlight('sewer-exit').sourceIdPrefixes).toContain('septic')
    expect(serviceHighlight('heat-pump').systems).toEqual(['hvac'])
  })
})
