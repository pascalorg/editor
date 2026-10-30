import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import {
  nearestWallParallelTarget,
  nudgeWallPosition,
  WALL_PARALLEL_SNAP_RADIUS,
  wallParallelTargets,
} from './wall-parallel-snap'

const wall = (id: string, start: [number, number], end: [number, number], extra = {}) =>
  WallNode.parse({ id: `wall_${id}`, start, end, thickness: 0.15, ...extra })
const outside = { frontSide: 'exterior', backSide: 'interior' } as const
const DOWN: [number, number] = [0, 1]

describe('wallParallelTargets', () => {
  test('an outside wall lines up with a parallel outside wall, not a partition', () => {
    const moving = wall('moving', [5, 0.3], [8, 0.3], outside)
    const top = wall('top', [0, 0.07], [4, 0.07], outside)
    const partition = wall('partition', [1, 0.2], [3, 0.2])
    const side = wall('side', [4, 0.07], [4, 4], outside)

    const targets = wallParallelTargets(moving, DOWN, [moving, top, partition, side])

    expect(targets.map((target) => target.wallId)).toEqual(['wall_top'])
    expect(targets).toHaveLength(1)
    expect(targets[0]!.position).toBeCloseTo(0.07)
    // The guide runs along both walls, on the top wall's outdoor face: frontSide
    // is the left-normal side, +z for a wall running +x.
    const [from, to] = [targets[0]!.from, targets[0]!.to]
    expect([from[0], to[0]]).toEqual([0, 8])
    expect(from[1]).toBeCloseTo(0.07 + 0.075)
    expect(to[1]).toBeCloseTo(0.07 + 0.075)
  })

  test('a partition lines up with every parallel wall', () => {
    const moving = wall('moving', [1, 2], [3, 2])
    const top = wall('top', [0, 0], [4, 0], outside)
    const other = wall('other', [1, 3], [3, 3])
    const ids = wallParallelTargets(moving, DOWN, [moving, top, other]).map((t) => t.wallId)
    expect(new Set(ids)).toEqual(new Set(['wall_top', 'wall_other']))
  })

  test('walls of different thickness line up face to face and centre to centre', () => {
    const moving = wall('moving', [5, 1], [8, 1], { ...outside, thickness: 0.2 })
    const top = wall('top', [0, 0], [4, 0], { ...outside, thickness: 0.1 })
    const positions = wallParallelTargets(moving, DOWN, [top]).map((t) => t.position)
    // Faces at ±0.05 against ±0.1, and the centres.
    expect(positions.map((p) => Number(p.toFixed(3))).sort()).toEqual([-0.05, 0, 0.05])
  })

  test('a reversed or justified wall lines up by its faces', () => {
    const moving = wall('moving', [8, 1], [5, 1], { ...outside, justification: 'a' })
    const top = wall('top', [0, 0], [4, 0], outside)
    const positions = wallParallelTargets(moving, DOWN, [top]).map((t) => t.position)
    // Justified 'a' on a wall running -x puts its body on the -z side of its
    // line, so its faces and centre all line up with the top wall's when that
    // line sits half a thickness below it.
    expect(positions.map((p) => Number(p.toFixed(3)))).toEqual([0.075])
  })
})

describe('nearestWallParallelTarget', () => {
  test('snaps within the radius and lets go past it', () => {
    const moving = wall('moving', [5, 0.3], [8, 0.3], outside)
    const targets = wallParallelTargets(moving, DOWN, [wall('top', [0, 0], [4, 0], outside)])
    expect(nearestWallParallelTarget(targets, 0.1)?.position).toBeCloseTo(0)
    expect(nearestWallParallelTarget(targets, WALL_PARALLEL_SNAP_RADIUS + 0.01)).toBeNull()
  })
})

describe('nudgeWallPosition', () => {
  const moving = wall('moving', [5, 0.3], [8, 0.3], outside)
  const targets = wallParallelTargets(moving, DOWN, [wall('top', [0, 0.29], [4, 0.29], outside)])

  test('stops on a line-up it would pass', () => {
    expect(nudgeWallPosition(targets, 0.3, -0.0254)).toBeCloseTo(0.29)
  })

  test('otherwise moves the whole step', () => {
    expect(nudgeWallPosition(targets, 0.3, 0.0254)).toBeCloseTo(0.3254)
    expect(nudgeWallPosition(targets, 0.29, -0.0254)).toBeCloseTo(0.2646)
  })
})
