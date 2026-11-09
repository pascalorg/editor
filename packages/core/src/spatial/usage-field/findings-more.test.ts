import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SiteNode,
  SlabNode,
  StairNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { measureBeds } from './beds'
import { usageIssues } from './findings'
import { usageShapes } from './shapes'
import { OPENS_FULLY_DEG } from './swings'
import type { Nodes } from './walls'

const SHA = 'c'.repeat(64)

const scene = (levels: number, extra: AnyNode[], heights: number[] = []): Nodes => {
  const ids = Array.from({ length: levels }, (_, i) => `level_${i + 1}`)
  return Object.fromEntries(
    [
      BuildingNode.parse({ id: 'building_1', children: ids }),
      ...ids.map((id, i) =>
        LevelNode.parse({
          id,
          parentId: 'building_1',
          level: i,
          children: [],
          ...(heights[i] ? { height: heights[i] } : {}),
        }),
      ),
      ...extra,
    ].map((node) => [node.id, node]),
  ) as Nodes
}
const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
  thickness = 0.1,
) => WallNode.parse({ id, parentId: 'level_1', start, end, thickness, children })
const zone = (
  id: string,
  name: string,
  polygon: [number, number][],
  level = 'level_1',
  extra: Record<string, unknown> = {},
) => ZoneNode.parse({ id, parentId: level, name, polygon, spaceRole: 'room', ...extra })
const slab = (
  id: string,
  level: string,
  polygon: [number, number][],
  extra: Record<string, unknown> = {},
) => SlabNode.parse({ id, parentId: level, polygon, elevation: 0.05, ...extra })
const room = (w: number, d: number, level = 'level_1'): [number, number][] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
]

/** A script-made piece with a stored solid outline (tolerance 9 mm: exact), centred on (x, z). */
const piece = (
  id: string,
  name: string,
  category: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  extra: Record<string, unknown> = {},
) =>
  ItemNode.parse({
    id,
    parentId: 'level_1',
    position: [x, 0, z],
    name,
    asset: {
      id,
      name,
      category,
      thumbnail: '/t.webp',
      src: `artifact://${SHA}`,
      dimensions: [width, height, depth],
    },
    source: {
      kind: 'script',
      script: SHA,
      artifact: SHA,
      manifest: {
        bounds: { min: [-width / 2, 0, -depth / 2], max: [width / 2, height, depth / 2] },
        triangles: 12,
        shape: {
          tolerance: 0.009,
          bands: [
            {
              y0: 0,
              y1: height,
              polygons: [
                {
                  outer: [
                    [-width / 2, -depth / 2],
                    [width / 2, -depth / 2],
                    [width / 2, depth / 2],
                    [-width / 2, depth / 2],
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    ...extra,
  })

const run = (nodes: Nodes, type: string) =>
  usageIssues(nodes, { cell: 0.05 }).filter((issue) => issue.type === type)

/** A 4 x 4 room whose west wall is on x = 0 (0.1 m thick: its room face is at x = 0.05). */
const closed = (extra: AnyNode[], heights: number[] = []) =>
  scene(
    heights.length || 1,
    [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [4.3, -0.3],
        [4.3, 4.3],
        [-0.3, 4.3],
      ]),
      wall('wall_s', [0, 0], [4, 0]),
      wall('wall_e', [4, 0], [4, 4]),
      wall('wall_n', [4, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      zone('zone_1', 'Study', room(4, 4)),
      ...extra,
    ],
    heights,
  )

describe('usage_clash', () => {
  test('an approximate outline 10 cm into a wall is information, and so is a contact', () => {
    const cupboard = piece('item_w', 'Wardrobe', 'wardrobe', 0.25, 2, 0.6, 1.5, 2)
    delete cupboard.source
    expect(run(closed([cupboard]), 'usage_clash')).toContainEqual(
      expect.objectContaining({ severity: 'info', approximate: true, thresholdM: 0.12 }),
    )
    cupboard.position[0] = 0.3
    expect(run(closed([cupboard]), 'usage_clash')).toContainEqual(
      expect.objectContaining({ severity: 'info', approximate: true, thresholdM: 0.12 }),
    )
  })

  test('approximate outlines warn from 12 cm, exact outlines from 8 cm', () => {
    const approximate = piece('item_a', 'Wardrobe', 'wardrobe', 0.25, 2, 0.6, 1.5, 2)
    delete approximate.source
    expect(run(closed([approximate]), 'usage_clash')).toContainEqual(
      expect.objectContaining({ severity: 'info', valueM: 0.1, thresholdM: 0.12 }),
    )
    const exact = piece('item_b', 'Wardrobe', 'wardrobe', 0.25, 2, 0.6, 1.5, 2)
    expect(run(closed([exact]), 'usage_clash')).toContainEqual(
      expect.objectContaining({ severity: 'warning', valueM: 0.1, thresholdM: 0.08 }),
    )
  })

  test('an approximate clash of 13 cm is a warning', () => {
    const sofa = piece('item_a', 'Sofa', 'sofa', 2, 2, 2, 0.9, 0.8)
    delete sofa.source
    const cabinet = piece('item_b', 'Sideboard', 'sideboard', 3.12, 2, 0.5, 0.5, 0.8)
    delete cabinet.source
    const found = run(closed([sofa, cabinet]), 'usage_clash')
    expect(found).toContainEqual(
      expect.objectContaining({ severity: 'warning', valueM: 0.13, thresholdM: 0.12 }),
    )
  })

  /** A bedroom whose south window carries a sill 0.3 m deep: its front is at z = 0.35. */
  const silled = (extra: AnyNode[]) =>
    scene(1, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [4.3, -0.3],
        [4.3, 4.3],
        [-0.3, 4.3],
      ]),
      wall('wall_s', [0, 0], [4, 0], ['window_1']),
      wall('wall_e', [4, 0], [4, 4]),
      wall('wall_n', [4, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      WindowNode.parse({
        id: 'window_1',
        parentId: 'wall_s',
        wallId: 'wall_s',
        position: [2, 1.5, 0],
        width: 1.6,
        height: 1.2,
        name: 'South window',
        sillDepth: 0.3,
        sillThickness: 0.05,
      }),
      zone('zone_1', 'Bedroom', room(4, 4)),
      ...extra,
    ])

  test('a bed 10 cm into a window sill is nothing, a sofa stays a clash and a bed into a wall stays one', () => {
    // z = 0.55 is 10 cm into the sill (0.05 to 0.35) and clear of the wall face
    const sillBed = piece('item_b', 'Bed', 'bed', 2, 0.55, 1.6, 0.6, 1.2)
    expect(run(silled([sillBed]), 'usage_clash')).toHaveLength(0)
    const sillSofa = piece('item_s', 'Sofa', 'sofa', 2, 0.55, 1.6, 0.6, 1.3)
    expect(run(silled([sillSofa]), 'usage_clash')).toContainEqual(
      expect.objectContaining({ severity: 'warning' }),
    )
    const wallBed = piece('item_w', 'Bed', 'bed', 0.25, 2, 1.6, 2.1, 0.5, {
      rotation: [0, Math.PI / 2, 0],
    })
    expect(run(silled([wallBed]), 'usage_clash')).toContainEqual(
      expect.objectContaining({ severity: 'warning', valueM: 0.1 }),
    )
  })

  test('two pieces: an overlap is a clash, a piece resting on another, a rug under a table, and foliage are not', () => {
    const sofa = piece('item_a', 'Sofa', 'sofa', 2, 2, 2, 0.9, 0.8)
    const chair = piece('item_b', 'Armchair', 'armchair', 2.9, 2, 0.9, 0.9, 0.8)
    const overlap = run(closed([sofa, chair]), 'usage_clash')
    expect(overlap).toHaveLength(1)
    expect(overlap[0]!.message).toContain('overlaps')
    expect(overlap[0]).toMatchObject({ severity: 'warning' })
    const lamp = piece('item_l', 'Table lamp', 'decor', 2, 2, 0.3, 0.3, 0.4, {
      position: [2, 0.8, 2],
    })
    expect(run(closed([sofa, lamp]), 'usage_clash')).toHaveLength(0)
    const rug = piece('item_r', 'Wool rug', 'rug', 2, 2, 2.5, 1.5, 0.01)
    expect(run(closed([sofa, rug]), 'usage_clash')).toHaveLength(0)
    const palm = piece('item_p', 'Potted palm', 'plant', 2.1, 2, 0.8, 0.8, 1.6)
    expect(run(closed([sofa, palm]), 'usage_clash')).toHaveLength(0)
  })
})

describe('usage_opening_blocked', () => {
  const windowed = (extra: AnyNode[]) =>
    scene(1, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [4.3, -0.3],
        [4.3, 4.3],
        [-0.3, 4.3],
      ]),
      wall('wall_s', [0, 0], [4, 0], ['window_1']),
      wall('wall_e', [4, 0], [4, 4]),
      wall('wall_n', [4, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      WindowNode.parse({
        id: 'window_1',
        parentId: 'wall_s',
        wallId: 'wall_s',
        position: [2, 1.5, 0],
        width: 1.6,
        height: 1.2,
        name: 'South window',
      }),
      zone('zone_1', 'Bedroom', room(4, 4)),
      ...extra,
    ])
  // the south wall's room face is at z = 0.05; the window's sill is 0.9 m up
  test('a wardrobe against the glass blocks it, a low sideboard under the sill and a piece beside it do not', () => {
    const wardrobe = piece('item_a', 'Wardrobe', 'wardrobe', 2, 0.05 + 0.3, 1.2, 0.6, 2)
    const found = run(windowed([wardrobe]), 'usage_opening_blocked')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warning' })
    expect(found[0]!.message).toContain('from the glass')
    const sideboard = piece('item_b', 'Sideboard', 'sideboard', 2, 0.05 + 0.25, 1.2, 0.5, 0.8)
    expect(run(windowed([sideboard]), 'usage_opening_blocked')).toHaveLength(0)
    const beside = piece('item_c', 'Wardrobe', 'wardrobe', 3.5, 0.05 + 0.3, 0.6, 0.6, 2)
    expect(run(windowed([beside]), 'usage_opening_blocked')).toHaveLength(0)
    const far = piece('item_d', 'Wardrobe', 'wardrobe', 2, 1.5, 1.2, 0.6, 2)
    expect(run(windowed([far]), 'usage_opening_blocked')).toHaveLength(0)
  })

  test('a bed head, a bedside piece or a lamp at a window is nothing', () => {
    const bed = piece('item_b', 'Bed', 'bed', 2, 0.05 + 0.3, 1.6, 0.6, 1.2)
    expect(run(windowed([bed]), 'usage_opening_blocked')).toHaveLength(0)
    const bedside = piece(
      'item_n',
      'Bedside table with lamp',
      'furniture',
      2,
      0.05 + 0.3,
      0.5,
      0.4,
      1.3,
    )
    expect(run(windowed([bedside]), 'usage_opening_blocked')).toHaveLength(0)
  })
})

describe('beds', () => {
  const bed = (
    id: string,
    x: number,
    z: number,
    width: number,
    extra: Record<string, unknown> = {},
  ) => piece(id, 'Bed', 'bed', x, z, width, 2.1, 0.5, extra)
  // a bed with its head on the north wall (z = 3.95), centred at x
  test('a king in a 3 m room is tight; a queen in a room that holds it is not', () => {
    const small = scene(1, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [3.3, -0.3],
        [3.3, 4.8],
        [-0.3, 4.8],
      ]),
      wall('wall_s', [0, 0], [3, 0]),
      wall('wall_e', [3, 0], [3, 4.5]),
      wall('wall_n', [3, 4.5], [0, 4.5]),
      wall('wall_w', [0, 4.5], [0, 0]),
      zone('zone_1', 'Bedroom', [
        [0, 0],
        [3, 0],
        [3, 4.5],
        [0, 4.5],
      ]),
      bed('item_k', 1.5, 4.45 - 1.05, 1.95),
    ])
    const [king] = measureBeds(small, usageShapes(small))
    expect(king).toMatchObject({ sizeClass: 'king', room: { name: 'Bedroom' } })
    expect(king!.left).toBeLessThan(0.6)
    expect(king!.right).toBeLessThan(0.6)
    const tight = run(small, 'usage_bed_clearance')
    expect(
      tight.some((issue) => issue.severity === 'warning' && issue.message.includes('no side')),
    ).toBe(true)
    expect(
      tight.some((issue) => issue.severity === 'info' && issue.message.includes('retailers')),
    ).toBe(true)
    const roomy = scene(1, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [5.3, -0.3],
        [5.3, 5.3],
        [-0.3, 5.3],
      ]),
      wall('wall_s', [0, 0], [5, 0]),
      wall('wall_e', [5, 0], [5, 5]),
      wall('wall_n', [5, 5], [0, 5]),
      wall('wall_w', [0, 5], [0, 0]),
      zone('zone_1', 'Bedroom', room(5, 5)),
      bed('item_q', 2.5, 4.95 - 1.05, 1.65),
    ])
    expect(run(roomy, 'usage_bed_clearance')).toHaveLength(0)
  })

  test('a queen bed with its bedside tables is read along its own head-to-foot axis, not as a king lying across', () => {
    // 2.65 m across with the bedsides, 2.11 m from head to foot, its head to the east wall
    const nodes = scene(1, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [5.3, -0.3],
        [5.3, 5.3],
        [-0.3, 5.3],
      ]),
      wall('wall_s', [0, 0], [5, 0]),
      wall('wall_e', [5, 0], [5, 5]),
      wall('wall_n', [5, 5], [0, 5]),
      wall('wall_w', [0, 5], [0, 0]),
      zone('zone_1', 'Bedroom', room(5, 5)),
      piece('item_c', 'Queen bed with bedside tables', 'bed', 3.895, 2.5, 2.65, 2.11, 0.5, {
        rotation: [0, (3 * Math.PI) / 2, 0],
      }),
    ])
    const [bed] = measureBeds(nodes, usageShapes(nodes))
    expect(bed).toMatchObject({ sizeClass: 'queen', widthM: 2.65, lengthM: 2.11 })
    expect(bed!.foot).toBeGreaterThan(2.5)
    expect(run(nodes, 'usage_bed_clearance')).toHaveLength(0)
  })
})

describe('usage_door_swing', () => {
  /** A 4 x 4 room whose south wall carries a door 0.9 m wide at `along` (hinged left, swinging into the room). */
  const doored = (along: number, extra: AnyNode[], door: Record<string, unknown> = {}) =>
    scene(1, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [4.3, -0.3],
        [4.3, 4.3],
        [-0.3, 4.3],
      ]),
      wall('wall_s', [0, 0], [4, 0], ['door_1']),
      wall('wall_e', [4, 0], [4, 4]),
      wall('wall_n', [4, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      DoorNode.parse({
        id: 'door_1',
        parentId: 'wall_s',
        wallId: 'wall_s',
        position: [along, 1.05, 0],
        width: 0.9,
        height: 2.1,
        name: 'Study door',
        hingesSide: 'left',
        swingDirection: 'inward',
        ...door,
      }),
      zone('zone_1', 'Study', room(4, 4)),
      ...extra,
    ])
  const swings = (nodes: Nodes) => run(nodes, 'usage_door_swing')

  test('a door in the open swings fully and says nothing; a piece in the sweep stops it at an angle, and the message says how it would open', () => {
    expect(swings(doored(2, []))).toHaveLength(0)
    // the leaf from the left jamb (x 1.55) sweeps toward +x then into the room: a wardrobe at x 2.1 to 2.4 meets it
    const wardrobe = piece('item_w', 'Wardrobe', 'wardrobe', 2.25, 0.5, 0.3, 0.3, 2)
    const found = swings(doored(2, [wardrobe]))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warning', thresholdDeg: 90 })
    expect(found[0]!.valueDeg).toBeLessThan(85)
    expect(found[0]!.message).toContain('“Wardrobe”')
    // hung the other way (out of the room) it is clear
    expect(found[0]!.message).toContain('opens fully if it swings the other way')
  })

  test('a door hung in the body of the wall that meets its jamb cannot open, and a flat leaf against a wall at 90 degrees is not a stop', () => {
    // the opening starts 5 cm inside the west wall's body
    const corner = swings(doored(0.4, []))
    expect(corner).toHaveLength(1)
    expect(corner[0]!.valueDeg).toBe(0)
    expect(corner[0]!.message).toContain('cannot open')
    // hinged at the far jamb (x 0.85 + ...) the leaf folds back along the wall's face at 90 degrees: fine
    expect(swings(doored(1.2, []))).toHaveLength(0)
  })

  test('a door at the foot of an up-flight meets the first treads, and swinging the other way is clear', () => {
    // the Windsor shape: a flight climbing +z from z = 1, and a door in the wall across its foot
    const foot = (swingDirection: 'inward' | 'outward') =>
      scene(
        1,
        [
          StairNode.parse({
            id: 'stair_1',
            parentId: 'level_1',
            name: 'Return stair',
            position: [2, 0, 1],
            totalRise: 2.8,
            stepCount: 14,
            width: 1,
          }),
          WallNode.parse({
            id: 'wall_f',
            parentId: 'level_1',
            start: [0, 1],
            end: [4, 1],
            thickness: 0.1,
            children: ['door_f'],
          }),
          DoorNode.parse({
            id: 'door_f',
            parentId: 'wall_f',
            wallId: 'wall_f',
            position: [2, 1.05, 0],
            width: 0.82,
            height: 2.1,
            name: 'Door 1',
            hingesSide: 'left',
            swingDirection,
          }),
        ],
        [2.8],
      )
    const found = swings(foot('inward'))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warning', approximate: false })
    expect(found[0]!.valueDeg).toBeLessThan(OPENS_FULLY_DEG)
    expect(found[0]!.message).toContain('“Return stair” (a stair)')
    expect(found[0]!.message).toContain('opens fully if it swings the other way')
    expect(found[0]!.obstacles[0]).toMatchObject({ nodeId: 'stair_1', kind: 'stair' })
    expect(swings(foot('outward'))).toHaveLength(0)
  })

  describe('stopped leaves warn, whatever outline the blocker has', () => {
    const cupboard = (at: [number, number], size: number) =>
      ItemNode.parse({
        id: 'item_b',
        parentId: 'level_1',
        position: [at[0], 0, at[1]],
        name: 'Cupboard',
        asset: {
          id: 'c',
          name: 'Cupboard',
          category: 'cabinet',
          thumbnail: '/t.webp',
          src: '/items/a/model.glb',
          dimensions: [size, 2, size],
        },
      })

    test('a leaf stopped early by a piece on an approximate outline is a warning, and the message says about', () => {
      const [found] = swings(doored(2, [cupboard([2.25, 0.5], 0.3)]))
      expect(found).toMatchObject({ severity: 'warning', approximate: true })
      expect(found?.valueDeg).toBeLessThan(60)
      expect(found!.message).toContain(`opens to about ${found!.valueDeg}° and no further`)
    })

    test('an approximate stop between 60 and 80 degrees still warns that the door cannot open fully', () => {
      const [found] = swings(doored(2, [cupboard([1.75, 0.8], 0.12)]))
      expect(found).toMatchObject({ severity: 'warning', approximate: true })
      expect(found?.valueDeg).toBeGreaterThanOrEqual(60)
      expect(found?.valueDeg).toBeLessThan(OPENS_FULLY_DEG)
    })

    test('a box round the door itself (a portal, trim the door stands in) is not what stops it', () => {
      const portal = ItemNode.parse({
        id: 'item_p',
        parentId: 'level_1',
        position: [2, 0, 0],
        name: 'Entry portal trim',
        asset: {
          id: 'p',
          name: 'Entry portal trim',
          category: 'trim',
          thumbnail: '/t.webp',
          src: '/items/a/model.glb',
          dimensions: [2.4, 2.4, 0.3],
        },
      })
      expect(swings(doored(2, [portal]))).toHaveLength(0)
      // beside the door, the same box meets the leaf
      const beside = ItemNode.parse({ ...portal, position: [2.25, 0, 0.7], dimensions: undefined })
      expect(swings(doored(2, [beside]))).toHaveLength(1)
    })

    test('a leaf that cannot open at all is still said to be against what it meets, with no about', () => {
      const [found] = swings(doored(0.4, []))
      expect(found).toMatchObject({ severity: 'warning', valueDeg: 0 })
      expect(found!.message).toContain('cannot open')
      expect(found!.message).not.toContain('about')
    })
  })
})

describe('usage_fixture_clearance', () => {
  /** A 4 x 4 room with a toilet facing the north wall at `gap` from it (its front 0.4 m clear of it when gap = 0.4). */
  const toiletRoom = (gap: number, extra: AnyNode[] = []) =>
    closed([piece('item_t', 'Toilet', 'toilet', 2, 3.95 - gap - 0.35, 0.4, 0.7, 0.8), ...extra])
  const site = (profile?: string) =>
    SiteNode.parse({ id: 'site_1', ...(profile ? { metadata: { codeProfile: profile } } : {}) })
  const clear = (nodes: Nodes) => run(nodes, 'usage_fixture_clearance')

  test('an approximate fixture lacking clearance warns only with a named jurisdiction', () => {
    for (const profile of [undefined, 'irc-2021']) {
      const nodes = toiletRoom(0.4, [site(profile)])
      const toilet = nodes.item_t
      if (toilet?.type !== 'item') throw new Error('Missing toilet')
      delete toilet.source
      expect(clear(nodes)).toContainEqual(
        expect.objectContaining({
          severity: profile ? 'warning' : 'info',
          approximate: true,
          code: expect.objectContaining({ byDefault: !profile }),
        }),
      )
    }
  })
})

describe('usage_door_over_stair', () => {
  /**
   * A 14-riser stair climbing +z from level 1 to level 2 (its top step at z 4), and a room on level 2 north of it,
   * whose south wall at z = 4 carries a door at the stair's head. The door is hinged left and swings `swingDirection`:
   * inward is into the room, outward is over the top treads.
   */
  const headOfStair = (swingDirection: 'inward' | 'outward', extra: AnyNode[] = []) =>
    scene(
      2,
      [
        StairNode.parse({
          id: 'stair_1',
          parentId: 'level_1',
          name: 'Cellar stair',
          position: [2, 0, 1],
          totalRise: 2.8,
          stepCount: 14,
          width: 1,
          fromLevelId: 'level_1',
          toLevelId: 'level_2',
        }),
        slab('slab_2', 'level_2', [
          [0, 4],
          [4, 4],
          [4, 8],
          [0, 8],
        ]),
        WallNode.parse({
          id: 'wall_2',
          parentId: 'level_2',
          start: [0, 4],
          end: [4, 4],
          thickness: 0.1,
          children: ['door_1'],
        }),
        DoorNode.parse({
          id: 'door_1',
          parentId: 'wall_2',
          wallId: 'wall_2',
          position: [2, 1.05, 0],
          width: 0.9,
          height: 2.1,
          name: 'Cellar door',
          hingesSide: 'left',
          swingDirection,
        }),
        zone(
          'zone_2',
          'Hall',
          [
            [0, 4],
            [4, 4],
            [4, 8],
            [0, 8],
          ],
          'level_2',
        ),
        ...extra,
      ],
      [2.8, 2.8],
    )
  const site = (profile: string) =>
    SiteNode.parse({ id: 'site_1', metadata: { codeProfile: profile } })
  const over = (nodes: Nodes) => run(nodes, 'usage_door_over_stair')

  test('a leaf that swings over the top treads is information that names the US IRC with no code named, a warning with irc-2021, and nothing with another code', () => {
    const none = over(headOfStair('outward'))
    expect(none).toHaveLength(1)
    expect(none[0]).toMatchObject({
      severity: 'info',
      code: { profile: 'irc-2021', source: 'code text', byDefault: true },
      approximate: false,
    })
    expect(none[0]!.valueM).toBeCloseTo(0.2, 2)
    expect(none[0]!.message).toContain(
      'the US IRC 2021 (IRC R311.7.6 / R311.3) wants a floor or landing for the leaf to open onto, and this project names no code',
    )
    expect(none[0]!.message).toContain(
      '“Cellar door” in “Hall” swings over the steps of “Cellar stair”',
    )
    expect(over(headOfStair('outward', [site('irc-2021')]))[0]).toMatchObject({
      severity: 'warning',
      code: { byDefault: false },
    })
  })

  test('the same door swinging into the room, away from the stair, says nothing', () => {
    expect(over(headOfStair('inward'))).toHaveLength(0)
  })
})
