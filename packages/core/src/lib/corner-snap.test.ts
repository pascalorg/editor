import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, LevelNode, WallNode, WindowNode } from '../schema'
import { CORNER_SNAP_EXIT_M, type CornerInput, evaluateCorner } from './corner-snap'

// Placing or dragging a window near a corner used to say nothing about joining the window on the
// other wall. The ghost snaps its edge to the corner inside a zone, the window waiting there is
// found for the highlight, and the zone has hysteresis so the hint does not flicker at its edge.
// Written first: no snap inside 0.30 m; snapping where no corner is; the zone flickering at its
// threshold; the window waiting on the other wall not found, or a pair's taken.

const LEVEL = 'level_s'

const cornerSnap = (nodes: Record<string, AnyNode>, input: CornerInput) =>
  evaluateCorner(nodes, input).snap
const cornerBlock = (nodes: Record<string, AnyNode>, input: CornerInput) =>
  evaluateCorner(nodes, input).block

/** Wall A (4 m) runs into the corner at the origin; wall B (3 m) leaves it at `degrees`. */
function scene(degrees: number, extra: AnyNode[] = [], extraWalls: AnyNode[] = []) {
  const rad = (degrees * Math.PI) / 180
  const a = WallNode.parse({ id: 'wall_a', parentId: LEVEL, start: [4, 0], end: [0, 0] })
  const b = WallNode.parse({
    id: 'wall_b',
    parentId: LEVEL,
    start: [0, 0],
    end: [3 * Math.cos(rad), 3 * Math.sin(rad)],
  })
  const level = LevelNode.parse({ id: LEVEL, children: [a.id, b.id] })
  // A wall lists its openings as children, as a scene does.
  const withChildren = (wall: typeof a) => ({
    ...wall,
    children: extra.filter((node) => node.parentId === wall.id).map((node) => node.id),
  })
  return Object.fromEntries(
    [level, withChildren(a), withChildren(b), ...extraWalls, ...extra].map((node) => [
      node.id,
      node,
    ]),
  )
}

const onWall = (id: string, wall: string, x: number, width = 1.2, extra = {}) =>
  WindowNode.parse({
    id,
    parentId: wall,
    wallId: wall,
    position: [x, 1.25, 0],
    width,
    height: 1.5,
    ...extra,
  })

/** The centre that leaves a window of `width` this far from the end of wall_a (4 m). */
const centreAt = (gap: number, width = 1.2) => 4 - gap - width / 2

describe('the corner zone', () => {
  test('snaps a window whose edge is within 0.30 m of a corner, to the corner', () => {
    const snap = cornerSnap(scene(90), { wallId: 'wall_a', centreX: centreAt(0.25), width: 1.2 })

    expect(snap?.end).toBe('end')
    expect(snap?.centreX).toBeCloseTo(4 - 0.6, 6)
    expect(snap?.otherWall.id).toBe('wall_b')
    expect(snap?.otherEnd).toBe('start')
  })

  test('does not snap farther out', () => {
    expect(
      cornerSnap(scene(90), { wallId: 'wall_a', centreX: centreAt(0.31), width: 1.2 }),
    ).toBeNull()
  })

  test('snaps at the other end of a wall too, and at the nearer end of a short one', () => {
    // wall_b leaves the corner at its start: a window 0.2 m from there.
    const snap = cornerSnap(scene(90), { wallId: 'wall_b', centreX: 0.2 + 0.5, width: 1 })
    expect(snap?.end).toBe('start')
    expect(snap?.centreX).toBeCloseTo(0.5, 6)
  })

  test('has hysteresis: held, the zone reaches out to its exit edge; not held, it does not', () => {
    const gap = (0.3 + CORNER_SNAP_EXIT_M) / 2
    const input = { wallId: 'wall_a', centreX: centreAt(gap), width: 1.2 }

    expect(cornerSnap(scene(90), input)).toBeNull()
    expect(cornerSnap(scene(90), { ...input, held: 'end' })?.end).toBe('end')
    expect(
      cornerSnap(scene(90), {
        wallId: 'wall_a',
        centreX: centreAt(CORNER_SNAP_EXIT_M + 0.02),
        width: 1.2,
        held: 'end',
      }),
    ).toBeNull()
  })

  test('is not a corner where no other wall ends', () => {
    // wall_a runs from (4, 0), a free end, to the corner at the origin: 0.1 m from the free end
    // there is nothing to join.
    expect(cornerSnap(scene(90), { wallId: 'wall_a', centreX: 0.1 + 0.6, width: 1.2 })).toBeNull()
  })

  test('is not a corner where three walls meet, nor one nearly straight, nor a wall too short', () => {
    const third = WallNode.parse({
      id: 'wall_c',
      parentId: LEVEL,
      start: [0, 0],
      end: [-2, 0],
    })
    const input = { wallId: 'wall_a', centreX: centreAt(0.1), width: 1.2 }

    expect(cornerSnap(scene(90, [], [third]), input)).toBeNull()
    expect(cornerSnap(scene(176), input)).toBeNull()
    expect(cornerSnap(scene(90), { ...input, width: 4.5 })).toBeNull()
  })
})

describe('the window waiting at the other wall’s corner', () => {
  const input = { wallId: 'wall_a', centreX: centreAt(0.1), width: 1.2 }

  test('is found, the nearest first', () => {
    const nodes = scene(90, [
      onWall('window_far', 'wall_b', 0.6 + 0.25),
      onWall('window_near', 'wall_b', 0.6 + 0.05),
    ])

    expect(cornerSnap(nodes, input)?.waitingId).toBe('window_near')
  })

  test('is none when the wall has none at the corner', () => {
    // Beyond 0.30 m of the corner, it is not waiting there (and leaves room for the match).
    const nodes = scene(90, [onWall('window_beyond', 'wall_b', 0.6 + 1.5)])

    expect(cornerSnap(nodes, input)?.waitingId).toBeNull()
  })

  test('is not one that is already a side of a corner window', () => {
    // The corner already holds a pair: wall_b's side, joined to the one on wall_a.
    const taken = onWall('window_taken', 'wall_b', 0.6, 1.2, {
      corner: { end: 'start', partnerId: 'window_partner', post: 'none' },
    })
    const partner = onWall('window_partner', 'wall_a', 4 - 0.6, 1.2, {
      corner: { end: 'end', partnerId: 'window_taken', post: 'none' },
    })

    // Taken, it is not waiting; with it in the way the match has no room, so no corner is offered.
    expect(cornerSnap(scene(90, [taken, partner]), input)).toBeNull()
    expect(cornerBlock(scene(90, [taken, partner]), input)?.reason).toBe('no_room')
  })

  test('is one whose pair is broken: its partner was deleted', () => {
    const orphan = onWall('window_orphan', 'wall_b', 0.6, 1.2, {
      corner: { end: 'start', partnerId: 'window_gone', post: 'none' },
    })

    expect(cornerSnap(scene(90, [orphan]), input)?.waitingId).toBe('window_orphan')
  })

  test('is never a draft still being placed', () => {
    const draft = onWall('window_draft', 'wall_b', 0.6, 1.2, { metadata: { isTransient: true } })

    expect(cornerSnap(scene(90, [draft]), input)?.waitingId).toBeNull()
  })

  test('is never the window being dragged', () => {
    const self = onWall('window_self', 'wall_a', centreAt(0.1))
    // Dragged along its own wall near the corner: nothing on wall_b waits, and it is not its own.
    expect(
      cornerSnap(scene(90, [self]), { ...input, ignoreId: 'window_self' })?.waitingId,
    ).toBeNull()
  })
})

// "Wrap the corner" was hard to find: a lone wall, a T-junction, a curved or curtain wall, an angle
// out of range, or no room for the match show nothing, so the hint says why where a window is
// placed or dragged within the zone. Written first: a reason where there is none, no reason where
// the corner would join, and the zone's hysteresis leaving the reason flickering.
describe('why a wall end is not a corner', () => {
  const input = { wallId: 'wall_a', centreX: centreAt(0.1), width: 1.2 }

  test('says nothing where the corner would join, and away from every wall end', () => {
    expect(cornerBlock(scene(90), input)).toBeNull()
    expect(cornerBlock(scene(90), { ...input, centreX: 2 })).toBeNull()
  })

  test('a free end: no other wall ends there', () => {
    expect(cornerBlock(scene(90), { wallId: 'wall_a', centreX: 0.1 + 0.6, width: 1.2 })).toEqual({
      reason: 'free_end',
      end: 'start',
    })
  })

  test('three walls meeting', () => {
    const third = WallNode.parse({ id: 'wall_c', parentId: LEVEL, start: [0, 0], end: [-2, 0] })

    expect(cornerBlock(scene(90, [], [third]), input)?.reason).toBe('several_walls')
  })

  test('an angle too close to straight or folded back', () => {
    expect(cornerBlock(scene(176), input)?.reason).toBe('angle')
    expect(cornerBlock(scene(4), input)?.reason).toBe('angle')
  })

  test('a curved wall, on either side of the corner', () => {
    const curved = (id: string, start: [number, number], end: [number, number]) =>
      WallNode.parse({ id, parentId: LEVEL, start, end, curveOffset: 0.4 })
    const withCurved = (nodes: Record<string, AnyNode>, wall: AnyNode) => ({
      ...nodes,
      [wall.id]: wall,
    })

    expect(
      cornerBlock(withCurved(scene(90), curved('wall_a', [4, 0], [0, 0])), input)?.reason,
    ).toBe('curved')
    expect(
      cornerBlock(withCurved(scene(90), curved('wall_b', [0, 0], [0, 3])), input)?.reason,
    ).toBe('curved')
  })

  test('a curtain wall, on either side of the corner', () => {
    const curtain = (id: string, start: [number, number], end: [number, number]) =>
      WallNode.parse({ id, parentId: LEVEL, start, end, wallType: 'curtain' })

    expect(
      cornerBlock({ ...scene(90), wall_b: curtain('wall_b', [0, 0], [0, 3]) }, input)?.reason,
    ).toBe('curtain')
    expect(
      cornerBlock({ ...scene(90), wall_a: curtain('wall_a', [4, 0], [0, 0]) }, input)?.reason,
    ).toBe('curtain')
  })

  test('no room for the match on the other wall: an opening already stands at its corner end', () => {
    const door = onWall('window_beside', 'wall_b', 0.6 + 1.25, 1.2)

    expect(
      cornerBlock(scene(90, [door]), { ...input, width: 2.5, centreX: 4 - 0.1 - 1.25 })?.reason,
    ).toBe('no_room')
  })

  test('a window waiting there needs no room: it is adopted', () => {
    const waiting = onWall('window_waiting', 'wall_b', 0.6)

    expect(cornerBlock(scene(90, [waiting]), input)).toBeNull()
    expect(cornerSnap(scene(90, [waiting]), input)?.waitingId).toBe('window_waiting')
  })

  // The HUD read "Join as a corner window" where the join was then refused on the click, and a plain
  // window was placed without a word: the join is checked before the click.
  test('a window waiting there that cannot slide to the corner: something in the way', () => {
    const self = onWall('window_self', 'wall_a', centreAt(0.1))
    const waiting = onWall('window_waiting', 'wall_b', 0.6 + 0.25)
    const door = DoorNode.parse({
      id: 'door_corner',
      parentId: 'wall_b',
      wallId: 'wall_b',
      position: [0.12, 1, 0],
      width: 0.2,
      height: 2,
    })
    const nodes = scene(90, [self, waiting, door])

    expect(evaluateCorner(nodes, { ...input, ignoreId: 'window_self' })).toEqual({
      snap: null,
      block: { reason: 'in_the_way', end: 'end' },
    })
  })

  test('a window waiting there too tall for this wall', () => {
    const self = onWall('window_self', 'wall_a', centreAt(0.1))
    const waiting = onWall('window_waiting', 'wall_b', 0.6, 1.2, {
      position: [0.6, 2.2, 0],
      height: 1.6,
    })
    const nodes = {
      ...scene(90, [self, waiting]),
      wall_a: { ...scene(90, [self]).wall_a!, height: 2.4 } as AnyNode,
    }

    expect(evaluateCorner(nodes, { ...input, ignoreId: 'window_self' }).block?.reason).toBe(
      'too_tall',
    )
  })

  test('keeps its reason across the zone’s edge like the snap does', () => {
    const gap = (0.3 + CORNER_SNAP_EXIT_M) / 2
    const edge = { wallId: 'wall_a', centreX: gap + 0.6, width: 1.2 }

    expect(cornerBlock(scene(90), edge)).toBeNull()
    expect(cornerBlock(scene(90), { ...edge, held: 'start' })?.reason).toBe('free_end')
  })
})
