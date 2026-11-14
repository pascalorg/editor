import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DoorNode,
  getRailingWallConfig,
  RAILING_GUARD_HEIGHT,
  railingWallDefaults,
  WallNode,
} from '@pascal-app/core'
import type { GuardBox } from '../stair/guard-path'
import { buildRailingWallFloorplan } from './railing-wall-floorplan'
import {
  buildRailingWallGeometry,
  RAILING_FRAME_MATERIAL_INDEX,
  RAILING_INFILL_MATERIAL_INDEX,
} from './railing-wall-geometry'
import { buildRailingWallGuard, railingWallRuns } from './railing-wall-guard'

const IN = 0.0254
const POST = 3.5 * IN

function railing(start: [number, number], end: [number, number], extra: Partial<WallNode> = {}) {
  return WallNode.parse({ start, end, ...railingWallDefaults(), ...extra })
}

/** A door `width` wide centred `at` metres along `wall`. */
function door(wall: WallNode, at: number, width = 0.9): AnyNode {
  return DoorNode.parse({ parentId: wall.id, wallId: wall.id, position: [at, 0.45, 0], width })
}

/** A box standing plumb: its section is `size[0]` × `size[1]`, its height `size[2]`. */
const plumb = (box: GuardBox) => box.direction[1] > 0.99

/** A box's reach along the wall (x in its frame) on a straight railing. */
const alongX = (box: GuardBox) => {
  const half = plumb(box) ? box.size[0] / 2 : (box.size[2] * Math.abs(box.direction[0])) / 2
  return [box.center[0] - half, box.center[0] + half] as const
}

/** A box's top over the floor. */
const topOf = (box: GuardBox) => box.center[1] + (plumb(box) ? box.size[2] : box.size[1]) / 2

describe('a railing wall’s guard', () => {
  test('posts stand at both ends and equally spaced between them, no more than 6 ft apart', () => {
    const wall = railing([0, 0], [6, 0])
    const { posts } = buildRailingWallGuard(wall, [], [wall])
    expect(posts.map(([x]) => Number(x.toFixed(6)))).toEqual([0, 1.5, 3, 4.5, 6])
    for (const [, y] of posts) expect(y).toBe(0)
  })

  test("the DCA 6 guard's members: the cap's top at the guard's height, balusters at most 3½ in clear", () => {
    const wall = railing([0, 0], [6, 0])
    const guard = buildRailingWallGuard(wall, [], [wall])
    expect(Math.max(...guard.frame.map(topOf))).toBeCloseTo(RAILING_GUARD_HEIGHT, 6)
    // Along the wall: the posts and balusters in order, every gap between them within 3½ in.
    const uprights = [
      ...guard.frame.filter((box) => plumb(box) && box.size[2] > 0.5),
      ...guard.infill,
    ]
      .map(alongX)
      .sort((a, b) => a[0] - b[0])
    expect(uprights.length).toBeGreaterThan(40)
    for (let i = 1; i < uprights.length; i++)
      expect(uprights[i]![0] - uprights[i - 1]![1]).toBeLessThanOrEqual(3.5 * IN + 1e-9)
    // The bottom rail's underside 3½ in over the floor.
    const rails = guard.frame.filter((box) => !plumb(box))
    expect(Math.min(...rails.map((box) => box.center[1] - box.size[1] / 2))).toBeCloseTo(
      3.5 * IN,
      6,
    )
  })

  test('a door is a gap with a post either side, its face on the gap’s edge, and nothing across it', () => {
    const wall = railing([0, 0], [6, 0])
    const guard = buildRailingWallGuard(wall, [door(wall, 3)], [wall])
    const xs = guard.posts.map(([x]) => x)
    expect(xs.some((x) => Math.abs(x - (2.55 - POST / 2)) < 1e-6)).toBe(true)
    expect(xs.some((x) => Math.abs(x - (3.45 + POST / 2)) < 1e-6)).toBe(true)
    for (const box of [...guard.frame, ...guard.infill]) {
      const [from, to] = alongX(box)
      expect(to <= 2.55 + 1e-6 || from >= 3.45 - 1e-6).toBe(true)
    }
    // Each side is a run of its own, its posts within 6 ft of each other.
    for (const side of [xs.filter((x) => x < 3), xs.filter((x) => x > 3)]) {
      expect(side.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < side.length; i++)
        expect(side[i]! - side[i - 1]!).toBeLessThanOrEqual(72 * IN + 1e-9)
    }
  })

  test('an end that dies into a solid wall has no post: the rails run on into the wall', () => {
    const house = WallNode.parse({ start: [0, -2], end: [0, 2], thickness: 0.15 })
    const wall = railing([0, 0], [3, 0])
    const guard = buildRailingWallGuard(wall, [], [wall, house])
    expect(guard.posts.every(([x]) => x > 0.1)).toBe(true)
    expect(guard.posts.some(([x]) => Math.abs(x - 3) < 1e-6)).toBe(true)
    const rails = guard.frame.filter((box) => !plumb(box))
    expect(Math.min(...rails.map((box) => alongX(box)[0]))).toBeCloseTo(0, 6)
    // A railing meeting another railing keeps its corner post.
    const corner = railing([0, 0], [0, 2])
    expect(buildRailingWallGuard(wall, [], [wall, corner]).posts[0]![0]).toBeCloseTo(0, 6)
  })

  test('a stretch too short for a post holds no guard, and a gap at an end leaves no post there', () => {
    const runs = railingWallRuns(
      4,
      [
        [0, 1],
        [1.05, 2],
      ],
      POST,
      { start: false, end: false },
    )
    expect(runs).toEqual([
      {
        from: 2 + POST / 2,
        to: 4,
        startPost: true,
        endPost: true,
        startGap: true,
        endGap: false,
      },
    ])
  })

  test('every style stands its posts at the config’s size and builds its infill', () => {
    for (const style of [
      'post-and-rail',
      'balusters',
      'cable',
      'boards',
      'glass',
      'metal',
    ] as const) {
      const wall = railing([0, 0], [4, 0], railingWallDefaults(style))
      const guard = buildRailingWallGuard(wall, [], [wall])
      expect(guard.infill.length).toBeGreaterThan(0)
      const posts = guard.frame.filter((box) => plumb(box) && box.size[2] > 0.5)
      expect(posts).toHaveLength(guard.posts.length)
      for (const post of posts)
        expect(post.size[0]).toBeCloseTo(getRailingWallConfig(wall).postSize, 9)
    }
  })

  test('the mesh draws the frame and the infill in groups of their own; the plan a square per post', () => {
    const wall = railing([0, 0], [6, 0])
    const geometry = buildRailingWallGeometry(wall, [], [wall])
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([
      RAILING_FRAME_MATERIAL_INDEX,
      RAILING_INFILL_MATERIAL_INDEX,
    ])
    const plan = buildRailingWallFloorplan(wall, [], [wall], '#000000')
    expect(plan).toHaveLength(5)
    expect(plan[0]).toMatchObject({ kind: 'polygon', fill: '#000000' })
  })

  test("a curved railing's posts follow its arc in plan", () => {
    const wall = railing([0, 0], [4, 0], { curveOffset: 1 })
    const { posts } = buildRailingWallGuard(wall, [], [wall], 'plan')
    expect(posts.length).toBeGreaterThan(2)
    expect(Math.max(...posts.map(([, , z]) => Math.abs(z)))).toBeGreaterThan(0.5)
  })
})
