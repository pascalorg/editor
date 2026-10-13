import { describe, expect, test } from 'bun:test'
import { cornerWindowIssues } from '../agent-operations/corner-window'
import { isAgentRefusal } from '../agent-tools/refusal'
import { type AnyNode, LevelNode, WallNode, WindowNode } from '../schema'
import {
  cornerPair,
  cornerPartnerUpdates,
  cornerSideWidth,
  planCornerWindow,
  unwrapCorner,
  wrapCorner,
} from './corner-window'

/**
 * L65: the 290's Bed 4 window wraps the corner of its bay; Pascal had no corner window (a window
 * ends at its wall and the corner stays solid). A corner window is two windows, one per wall, both
 * running to the corner and joined, the glass fused at the corner (or meeting at a thin post), at
 * any angle the walls make. What goes wrong, written first: a window stopping short of the corner;
 * the two sides out of step (heights, sills); one wall's side placed on the wrong wall or end; a
 * square-only answer at a bay's 135° or an acute 60°; a degenerate corner accepted; unwrapping
 * deleting a window.
 */

type Nodes = Record<string, AnyNode>
const LEVEL = 'level_corner'

/** Wall A runs into the corner at the origin; wall B leaves it at `degrees` from A. */
function cornerScene(degrees: number, extra: AnyNode[] = []): Nodes {
  const rad = (degrees * Math.PI) / 180
  const a = WallNode.parse({ id: 'wall_a', parentId: LEVEL, start: [4, 0], end: [0, 0] })
  const b = WallNode.parse({
    id: 'wall_b',
    parentId: LEVEL,
    start: [0, 0],
    end: [4 * Math.cos(rad), 4 * Math.sin(rad)],
  })
  const level = LevelNode.parse({ id: LEVEL, children: [a.id, b.id, ...extra.map((n) => n.id)] })
  return Object.fromEntries([level, a, b, ...extra].map((node) => [node.id, node]))
}

const apply = (nodes: Nodes, windows: WindowNode[]) => ({
  ...nodes,
  ...Object.fromEntries(windows.map((window) => [window.id, window])),
})

const refusalOf = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return null
}

for (const degrees of [90, 135, 60])
  describe(`a corner window at ${degrees}°`, () => {
    test('one window on each wall, each running to the corner, joined and fused', () => {
      const { windows } = planCornerWindow(cornerScene(degrees), { corner: [0, 0], width: 1.2 })
      const [onA, onB] = ['wall_a', 'wall_b'].map((id) => windows.find((w) => w.parentId === id)!)
      // Wall A is 4 m long and ends at the corner; wall B starts there.
      expect(onA!.position[0]).toBeCloseTo(4 - 0.6, 6)
      expect(onB!.position[0]).toBeCloseTo(0.6, 6)
      expect(onA!.corner).toEqual({ end: 'end', partnerId: onB!.id, post: 'none' })
      expect(onB!.corner).toEqual({ end: 'start', partnerId: onA!.id, post: 'none' })
      expect([onA!.height, onA!.position[1]]).toEqual([onB!.height, onB!.position[1]])
      const pair = cornerPair(apply(cornerScene(degrees), windows), onA!)
      expect(pair?.partner.id).toBe(onB!.id)
      expect(pair?.angle).toBeCloseTo(degrees, 6)
    })

    test('each side takes its own width, and a post on request', () => {
      const { windows } = planCornerWindow(cornerScene(degrees), {
        corner: [0, 0],
        width: 1.2,
        widths: { wall_b: 1.6 },
        post: 'post',
      })
      const onB = windows.find((w) => w.parentId === 'wall_b')!
      expect([onB.width, onB.position[0], onB.corner?.post]).toEqual([1.6, 0.8, 'post'])
    })
  })

// A window with no sill is centred on its wall; the two sides of a corner window must keep one sill
// whatever their walls, so with walls of two heights both are centred on the lower one.
describe('a corner window with no sill given', () => {
  const heights = (a: number, b: number) => {
    const nodes = cornerScene(90)
    nodes.wall_a = WallNode.parse({ ...nodes.wall_a, height: a })
    nodes.wall_b = WallNode.parse({ ...nodes.wall_b, height: b })
    return planCornerWindow(nodes, { corner: [0, 0], width: 1.2 }).windows
  }
  const sill = (window: WindowNode) => window.position[1] - window.height / 2

  test('is centred on its walls when they are as tall', () => {
    const windows = heights(2.5, 2.5)
    expect(windows.map(sill)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)])
  })

  test('keeps one sill across walls of two heights, centred on the lower', () => {
    const windows = heights(2.5, 3)
    expect(windows.map(sill)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)])
  })

  test('keeps the sill it is given on both sides', () => {
    const nodes = cornerScene(90)
    const { windows } = planCornerWindow(nodes, { corner: [0, 0], width: 1.2, sillHeight: 0.9 })
    expect(windows.map(sill)).toEqual([expect.closeTo(0.9, 6), expect.closeTo(0.9, 6)])
  })
})

describe('what a corner window refuses', () => {
  test('a point where no two walls meet', () => {
    expect(refusalOf(() => planCornerWindow(cornerScene(90), { corner: [2, 0], width: 1 }))).toBe(
      'no_corner',
    )
  })

  test('a degenerate corner, nearly folded back or nearly straight', () => {
    for (const degrees of [5, 176])
      expect(
        refusalOf(() => planCornerWindow(cornerScene(degrees), { corner: [0, 0], width: 1 })),
      ).toBe('corner_angle')
  })

  test('a side wider than its wall', () => {
    expect(refusalOf(() => planCornerWindow(cornerScene(90), { corner: [0, 0], width: 4.5 }))).toBe(
      'width_exceeds_wall',
    )
  })

  test('three walls at the point, without saying which two', () => {
    const c = WallNode.parse({ id: 'wall_c', parentId: LEVEL, start: [0, 0], end: [0, -3] })
    const nodes = cornerScene(90, [c])
    expect(refusalOf(() => planCornerWindow(nodes, { corner: [0, 0], width: 1 }))).toBe(
      'corner_ambiguous',
    )
    expect(
      planCornerWindow(nodes, { corner: [0, 0], width: 1, wallIds: ['wall_a', 'wall_c'] })
        .windows.map((w) => w.parentId)
        .sort(),
    ).toEqual(['wall_a', 'wall_c'])
  })
})

describe('by hand: wrap, keep in step, unwrap', () => {
  const plain = () => {
    const { windows } = planCornerWindow(cornerScene(135), { corner: [0, 0], width: 1.2 })
    const onA = windows.find((w) => w.parentId === 'wall_a')!
    const { corner: _corner, ...rest } = onA
    return { nodes: apply(cornerScene(135), [rest as WindowNode]), window: rest as WindowNode }
  }

  test('a window ending at a corner wraps it: its partner takes its width, height and sill', () => {
    const { nodes, window } = plain()
    const { create, updates } = wrapCorner(nodes, window.id)
    expect(create?.parentId).toBe('wall_b')
    expect([create?.width, create?.height, create?.position[1]]).toEqual([
      window.width,
      window.height,
      window.position[1],
    ])
    expect(updates).toEqual({
      [window.id]: { corner: { end: 'end', partnerId: create?.id, post: 'none' } },
    })
  })

  // The owner (8 October): a window a few cm short of the corner showed no Corner section at all.
  const onWall = (id: string, wall: string, x: number, width = 1.2) =>
    WindowNode.parse({
      id,
      parentId: wall,
      wallId: wall,
      position: [x, 1.25, 0],
      width,
      height: 1.5,
    })

  test('a window near a corner, not at it, is slid to the corner when it wraps', () => {
    // 0.10 m short of the end of wall_a (4 m long): its right edge is at 3.9 m.
    const near = onWall('window_near', 'wall_a', 3.3)
    const { create, updates } = wrapCorner(apply(cornerScene(90), [near]), near.id)
    expect(updates.window_near?.position?.[0]).toBeCloseTo(3.4, 6)
    expect(updates.window_near?.corner).toEqual({
      end: 'end',
      partnerId: create?.id,
      post: 'none',
    })
    expect(create?.position[0]).toBeCloseTo(0.6, 6)
  })

  test('a window farther than 0.30 m from a corner has none to wrap', () => {
    const far = onWall('window_far', 'wall_a', 3.0)
    expect(refusalOf(() => wrapCorner(apply(cornerScene(90), [far]), far.id))).toBe('no_corner')
  })

  test('a window already waiting at the other wall’s corner is adopted, not recreated', () => {
    const near = onWall('window_near', 'wall_a', 3.3)
    // 0.20 m short of the corner on wall_b, a different height and sill.
    const waiting = WindowNode.parse({
      id: 'window_waiting',
      parentId: 'wall_b',
      wallId: 'wall_b',
      position: [0.7, 1.4, 0],
      width: 1,
      height: 1.2,
    })
    const { create, updates } = wrapCorner(apply(cornerScene(90), [near, waiting]), near.id)
    expect(create).toBeNull()
    expect(Object.keys(updates).sort()).toEqual(['window_near', 'window_waiting'])
    expect(updates.window_waiting?.position?.[0]).toBeCloseTo(0.5, 6)
    expect(updates.window_waiting?.height).toBe(1.5)
    expect(updates.window_waiting?.corner).toEqual({
      end: 'start',
      partnerId: 'window_near',
      post: 'none',
    })
  })

  test('a window that is already one side of a pair is not adopted', () => {
    const near = onWall('window_near', 'wall_a', 3.3)
    const taken = WindowNode.parse({
      ...onWall('window_taken', 'wall_b', 0.7, 1),
      corner: { end: 'start', partnerId: 'window_elsewhere', post: 'none' },
    })
    const { create } = wrapCorner(apply(cornerScene(90), [near, taken]), near.id)
    expect(create?.parentId).toBe('wall_b')
  })

  test('a height or sill changed on one side changes the other', () => {
    const { windows } = planCornerWindow(cornerScene(90), { corner: [0, 0], width: 1.2 })
    const nodes = apply(cornerScene(90), windows)
    const onA = windows.find((w) => w.parentId === 'wall_a')!
    expect(cornerPartnerUpdates(nodes, onA.id, { height: 1.8 })).toMatchObject({
      height: 1.8,
    })
    expect(cornerPartnerUpdates(nodes, onA.id, { width: 2 })).toBeNull()
  })

  test('unwrapping keeps both windows, plain, ending at the corner', () => {
    const { windows } = planCornerWindow(cornerScene(90), { corner: [0, 0], width: 1.2 })
    const nodes = apply(cornerScene(90), windows)
    const updates = unwrapCorner(nodes, windows[0]!.id)
    expect(Object.keys(updates).sort()).toEqual(windows.map((w) => w.id).sort())
    for (const patch of Object.values(updates)) expect(patch).toEqual({ corner: undefined })
  })
})

describe('verify_scene on corner windows', () => {
  test('two plain windows running to the same corner are pointed at add_corner_window', () => {
    const { windows } = planCornerWindow(cornerScene(90), { corner: [0, 0], width: 1.2 })
    const plain = windows.map(({ corner: _corner, ...rest }) => rest as WindowNode)
    const issues = cornerWindowIssues(apply(cornerScene(90), plain))
    expect(issues.map((issue) => issue.type)).toEqual(['corner_unjoined'])
    expect(issues[0]!.message).toContain('add_corner_window')
  })

  test('a joined pair in step is quiet; drifted apart, it is named', () => {
    const { windows } = planCornerWindow(cornerScene(90), { corner: [0, 0], width: 1.2 })
    expect(cornerWindowIssues(apply(cornerScene(90), windows))).toEqual([])
    const [a, b] = windows as [WindowNode, WindowNode]
    const drifted = apply(cornerScene(90), [a, { ...b, height: 1.2 }])
    expect(cornerWindowIssues(drifted).map((issue) => issue.type)).toEqual(['corner_out_of_step'])
  })
})

describe('one side wider or narrower', () => {
  test('its corner end stays at the corner, the free edge moves', () => {
    const { windows } = planCornerWindow(cornerScene(90), { corner: [0, 0], width: 1.2 })
    const nodes = apply(cornerScene(90), windows)
    const onA = windows.find((w) => w.parentId === 'wall_a')!
    expect(cornerSideWidth(nodes, onA.id, 2)).toEqual({
      width: 2,
      position: [3, onA.position[1], onA.position[2]],
    })
  })

  test('dragged off its corner, a window is no longer one side of the pair', () => {
    const { windows } = planCornerWindow(cornerScene(90), { corner: [0, 0], width: 1.2 })
    const [a, b] = windows as [WindowNode, WindowNode]
    const moved = { ...a, position: [2, a.position[1], a.position[2]] as [number, number, number] }
    expect(cornerPair(apply(cornerScene(90), [moved, b]), moved)).toBeNull()
  })
})
