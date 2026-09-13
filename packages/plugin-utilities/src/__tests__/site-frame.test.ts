import { describe, expect, test } from 'bun:test'
import { drawUtilityPole } from '../utility-pole/floorplan'
import { IDENTITY_DRAW_CONTEXT, siteDrawContext } from '../draw-context'
import { dashIntervals, polylineLength3 } from '../geometry/dash'
import type { Vec3 } from '../geometry/catenary'
import {
  type BuildingFrame,
  localToSite,
  localToSitePlan,
  siteToLocal,
  siteToLocalPlan,
} from '../site-frame'
import { UtilityPoleNode } from '../schema'

const frame: BuildingFrame = { id: 'building_1', origin: [12, 0, -7], yaw: Math.PI / 6 }

describe('site ⇄ building-local frame', () => {
  test('round-trips a 3D point', () => {
    const site: [number, number, number] = [3.5, 2, -8.25]
    const back = localToSite(frame, siteToLocal(frame, site))
    expect(back[0]).toBeCloseTo(site[0], 10)
    expect(back[1]).toBeCloseTo(site[1], 10)
    expect(back[2]).toBeCloseTo(site[2], 10)
  })

  test('round-trips a plan point', () => {
    const site: [number, number] = [-4, 19]
    const back = localToSitePlan(frame, siteToLocalPlan(frame, site))
    expect(back[0]).toBeCloseTo(site[0], 10)
    expect(back[1]).toBeCloseTo(site[1], 10)
  })

  test('matches the three.js +Y rotation the building renderer applies', () => {
    // world = origin + Ry(yaw)·local, and three maps local (x,y,z) to
    // (x·cos + z·sin, y, −x·sin + z·cos).
    const local: [number, number, number] = [2, 0, 5]
    const cos = Math.cos(frame.yaw)
    const sin = Math.sin(frame.yaw)
    const expected = [
      frame.origin[0] + local[0] * cos + local[2] * sin,
      frame.origin[1],
      frame.origin[2] - local[0] * sin + local[2] * cos,
    ]
    const site = localToSite(frame, local)
    expect(site[0]).toBeCloseTo(expected[0]!, 10)
    expect(site[2]).toBeCloseTo(expected[2]!, 10)
  })

  test('elevation is untouched by yaw', () => {
    expect(siteToLocal(frame, [1, 4.25, 2])[1]).toBeCloseTo(4.25, 10)
  })
})

describe('draw contexts', () => {
  test('the site context emits SITE coordinates unchanged', () => {
    const pole = UtilityPoleNode.parse({ position: [11, -3] })
    const geometry = drawUtilityPole(pole, siteDrawContext({}, pole as never)) as {
      children: Array<{ kind: string; cx?: number; cy?: number }>
    }
    const circle = geometry.children.find((child) => child.kind === 'circle')
    expect(circle?.cx).toBeCloseTo(11, 10)
    expect(circle?.cy).toBeCloseTo(-3, 10)
  })

  test('the identity context is the site context with no scene', () => {
    expect(IDENTITY_DRAW_CONTEXT.toPlan([4, 5])).toEqual([4, 5])
  })
})

describe('buried dash intervals', () => {
  const path: Vec3[] = [
    [0, -0.75, 0],
    [10, -0.75, 0],
  ]

  test('dashes never run past the end of the polyline', () => {
    const total = polylineLength3(path)
    for (const interval of dashIntervals(path, 0.7, 0.35)) {
      expect(interval.end[0]).toBeLessThanOrEqual(total + 1e-9)
    }
  })

  test('the pattern repeats every dash + gap', () => {
    const intervals = dashIntervals(path, 0.7, 0.35)
    expect(intervals.length).toBeGreaterThan(5)
    expect((intervals[1]!.start[0] as number) - (intervals[0]!.start[0] as number)).toBeCloseTo(
      1.05,
      10,
    )
  })

  test('the pattern runs continuously across a corner', () => {
    const corner: Vec3[] = [
      [0, -0.75, 0],
      [1, -0.75, 0],
      [1, -0.75, 5],
    ]
    const intervals = dashIntervals(corner, 0.7, 0.35)
    // A dash that starts at 0.7+0.35=1.05 m spans the corner at 1 m: its
    // start is on the second leg, not restarted at the vertex.
    const spanning = intervals[1]!
    expect(spanning.start[0]).toBeCloseTo(1, 10)
    expect(spanning.start[2]).toBeCloseTo(0.05, 10)
  })

  test('a degenerate run produces no dashes', () => {
    expect(dashIntervals([[0, 0, 0]], 0.7, 0.35)).toEqual([])
  })
})
