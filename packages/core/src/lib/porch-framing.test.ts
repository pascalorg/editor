import { describe, expect, test } from 'bun:test'
import { type AnyNode, WallNode } from '../schema'
import { FRAMING_POST_SIZES } from './framing-post'
import { PORCH_POST_SETBACK, planPorchFraming } from './porch-framing'

const LEVEL = 'level_porch'
const wall = (id: string, start: [number, number], end: [number, number]) =>
  WallNode.parse({ id: `wall_${id}`, parentId: LEVEL, start, end, thickness: 0.15 })
const nodes = (...walls: WallNode[]): Record<string, AnyNode> =>
  Object.fromEntries(walls.map((node) => [node.id, node]))

// A porch in a corner of the house: house walls along z = 0 and x = 0, open on the other two sides.
const corner = {
  parentId: LEVEL,
  polygon: [
    [0, 0],
    [3, 0],
    [3, 2.5],
    [0, 2.5],
  ] as Array<[number, number]>,
}
const house = nodes(wall('south', [0, 0], [6, 0]), wall('west', [0, 6], [0, 0]))
const inset = FRAMING_POST_SIZES['6x6'] / 2 + PORCH_POST_SETBACK

describe('planPorchFraming', () => {
  test('a porch in a corner of the house gets its one corner post', () => {
    const { posts } = planPorchFraming(corner, house)
    const cornerPost = posts.find((post) => post.key.startsWith('corner:'))!
    expect(cornerPost.position[0]).toBeCloseTo(3 - inset, 9)
    expect(cornerPost.position[1]).toBeCloseTo(2.5 - inset, 9)
    expect(posts.filter((post) => post.key.startsWith('corner:'))).toHaveLength(1)
  })

  test('a side longer than the spacing gets posts between, evenly; none against the house', () => {
    const { posts } = planPorchFraming(corner, house)
    // The 3 m side reaches 2.8 m from the west wall's face to the corner post: two bays at 8 ft.
    const between = posts.filter((post) => post.key.startsWith('side:'))
    expect(between).toHaveLength(1)
    const start = 0.075
    const end = 3 - inset
    expect(between[0]!.position[0]).toBeCloseTo((start + end) / 2, 9)
    expect(between[0]!.position[1]).toBeCloseTo(2.5 - inset, 9)
    expect(posts.every((post) => post.position[0] > 0.07 && post.position[1] > 0.07)).toBe(true)
  })

  test('a beam runs along each open side, from the house wall face to the corner post', () => {
    const { beams } = planPorchFraming(corner, house)
    expect(beams).toHaveLength(2)
    const east = beams.find((beam) => Math.abs(beam.start[0] - beam.end[0]) < 1e-9)!
    expect(east.start[0]).toBeCloseTo(3 - inset, 9)
    expect(Math.min(east.start[1], east.end[1])).toBeCloseTo(0.075, 9)
    // It reaches the corner post's outside face.
    expect(Math.max(east.start[1], east.end[1])).toBeCloseTo(
      2.5 - inset + FRAMING_POST_SIZES['6x6'] / 2,
      9,
    )
  })

  test('closer post spacing adds posts; a walled-in room has none', () => {
    const tight = planPorchFraming({ ...corner, porchFraming: { postSpacing: 1 } }, house)
    expect(tight.posts.length).toBeGreaterThan(planPorchFraming(corner, house).posts.length)
    const closed = planPorchFraming(
      corner,
      nodes(
        wall('south', [0, 0], [3, 0]),
        wall('east', [3, 0], [3, 2.5]),
        wall('north', [3, 2.5], [0, 2.5]),
        wall('west', [0, 2.5], [0, 0]),
      ),
    )
    expect(closed).toEqual({ posts: [], beams: [] })
  })

  test('a railing side still carries posts and the beam', () => {
    const railing = {
      ...wall('rail', [3, 0], [3, 2.5]),
      wallType: 'railing',
    } as unknown as WallNode
    const { beams } = planPorchFraming(corner, nodes(...Object.values(house), railing) as never)
    expect(beams).toHaveLength(2)
  })
})
