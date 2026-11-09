import { describe, expect, test } from 'bun:test'
import { graph } from '../coherence/__fixtures__/enclosure-scenes'
import { type AnyNode, WallNode } from '../schema'
import {
  house,
  MARBLE,
  PAINT,
  PARQUET,
  type PieceSpec,
  type RoomSpec,
  TILE,
} from './__fixtures__/room-check-scenes'
import './index'
import { roomCheckIssues } from './room-checks'
import { finishTiled } from './room-tile'
import type { SceneNodes } from './types'

const issuesOf = (rooms: RoomSpec[]) => roomCheckIssues(house(...rooms).nodes as SceneNodes)
const typesOf = (rooms: RoomSpec[]) => issuesOf(rooms).map((issue) => issue.type)

describe('a wet room owes tile on its walls', () => {
  const bath = (floor: string, walls: string): RoomSpec => ({
    name: 'Salle de bains',
    floor,
    walls,
    skirting: true,
  })
  test.each([
    ['bare floor and bare walls', bath(PARQUET, PAINT), ['room_wet_untiled']],
    ['a tiled floor does not make up for bare walls', bath(TILE, PAINT), ['room_wet_untiled']],
    ['marble underfoot does not either', bath(MARBLE, PAINT), ['room_wet_untiled']],
    ['tiled walls', bath(PARQUET, TILE), []],
    ['walls the nodes cannot name are not read as bare', bath(TILE, 'scene:unknown'), []],
    ['a laundry is wet too', { ...bath(PARQUET, PAINT), name: 'Buanderie' }, ['room_wet_untiled']],
    ['a bedroom is not', { ...bath(PARQUET, PAINT), name: 'Chambre 2' }, []],
  ])('%s', (_, room, expected) => {
    expect(typesOf([room]).filter((type) => type === 'room_wet_untiled')).toEqual(expected)
  })

  describe('tile to a height, and to the ceiling around the shower', () => {
    const room = (extra: Partial<RoomSpec>): RoomSpec => ({ ...bath(TILE, PAINT), ...extra })
    const SHOWER: PieceSpec = [
      'showers',
      'shower',
      { size: [0.9, 2, 0.9], at: [3.5, 3.5], name: 'Douche' },
    ]
    const SINK: PieceSpec = ['sinks', 'sink', { at: [2, 0.3] }]
    /** The shower's corner: its stretch of the east wall and of the south wall, full height. */
    const SURROUND = [
      { wall: 1, u0: 2.95, u1: 4, finish: TILE },
      { wall: 2, u0: 0, u1: 1.05, finish: TILE },
    ]
    const wet = (spec: RoomSpec) =>
      issuesOf([spec]).find((issue) => issue.type === 'room_wet_untiled')

    test.each([
      [
        'a splash of 0.30 m',
        room({ regions: [{ v1: 0.3, finish: TILE }] }),
        'has tile up to 0.30 m',
      ],
      ['tile to 0.90 m', room({ regions: [{ v1: 0.9, finish: TILE }] }), 'has tile up to 0.90 m'],
      [
        'tile to 1.2 m on a quarter of the walls',
        room({ regions: [{ u1: 1, v1: 1.2, finish: TILE }] }),
        'has tile on part of its walls',
      ],
    ])('%s does not make a wet room tiled', (_, spec, lead) => {
      expect(wet(spec)?.message).toContain(lead)
      expect(wet(spec)?.message).toContain('tile its walls to 1.20 m')
    })

    test.each([
      ['tile to 1.2 m on every wall', room({ regions: [{ v1: 1.2, finish: TILE }] })],
      ['tile the full height', room({ walls: TILE })],
      ['tile the full height, with a shower', room({ walls: TILE, pieces: [SHOWER] })],
      [
        'tile to 1.2 m and the shower surround to the ceiling',
        room({ regions: [{ v1: 1.2, finish: TILE }, ...SURROUND], pieces: [SHOWER] }),
      ],
      [
        'tile to 1.2 m where no shower stands',
        room({
          regions: [{ v1: 1.2, finish: TILE }],
          pieces: [['showers', 'shower', { size: [0.9, 2, 0.9], at: [2, 2] }]],
        }),
      ],
    ])('%s does', (_, spec) => {
      expect(wet(spec)).toBeUndefined()
    })

    test('a shower whose surround stops at 1.2 m is named, with the call that tiles around it', () => {
      const issue = wet(room({ regions: [{ v1: 1.2, finish: TILE }], pieces: [SHOWER] }))
      expect(issue?.message).toContain('not to the ceiling around its shower (Douche)')
      expect(issue?.message).toContain('tile the walls around Douche to the ceiling')
    })

    test('the walls read are those the fixtures stand against, else all of them', () => {
      const northOnly = { wall: 0, v1: 1.2, finish: TILE }
      expect(wet(room({ regions: [northOnly], pieces: [SINK] }))).toBeUndefined()
      expect(wet(room({ regions: [northOnly], pieces: [['sinks', 'sink']] }))).toBeDefined()
      expect(
        wet(room({ regions: [{ ...northOnly, wall: 1 }], pieces: [SINK] }))?.message,
      ).toContain('shows no tile on the walls its fixtures stand against')
    })
  })

  describe('a finish reads as tile or not', () => {
    const made = (material: object) => ({ mat_x: { id: 'mat_x', name: 'x', material } })
    const flat = { properties: { color: '#eee9df' } }
    test.each([
      [
        'a library finish of the tile kind',
        { ref: 'library:flooring-tiles3', name: 'Checker Tiles', kind: 'tile' },
        undefined,
        'yes',
      ],
      [
        'a library wood',
        { ref: 'library:wood-woodparquet14', name: 'Wood Parquet 14', kind: 'wood' },
        undefined,
        'no',
      ],
      [
        'a French tile word, accents folded',
        { ref: 'scene:mat_a', name: 'Mosaïque bleue' },
        {},
        'yes',
      ],
      ['grès cérame', { ref: 'scene:mat_b', name: 'Grès cérame anthracite' }, {}, 'yes'],
      ['a written colour is paint', { ref: '#2f5f3f', name: '#2f5f3f' }, undefined, 'no'],
      [
        'a generated material of the tile preset',
        { ref: 'scene:mat_x', name: 'Fond' },
        made({ preset: 'tile' }),
        'yes',
      ],
      [
        'a generated flat colour is paint, whatever it is called',
        { ref: 'scene:mat_x', name: 'Ivoire mat' },
        made(flat),
        'no',
      ],
      [
        'a generated texture could be either',
        { ref: 'scene:mat_x', name: 'Fond' },
        made({ ...flat, texture: { url: '/t.png' } }),
        'unknown',
      ],
      [
        'a generated material the scene does not hold',
        { ref: 'scene:mat_gone', name: 'scene:mat_gone' },
        {},
        'unknown',
      ],
      ['an inline material', { ref: null, name: 'an inline material' }, undefined, 'unknown'],
    ] as const)('%s', (_, fact, materials, expected) => {
      expect(finishTiled(fact, materials as never)).toBe(expected)
    })
  })

  test('the finding names the room and what its surfaces show', () => {
    const [issue] = issuesOf([bath(PARQUET, PAINT)])
    expect(issue?.message).toContain('Salle de bains (bathroom, Ground)')
    expect(issue?.message).toContain('Wood Parquet 14')
    expect(issue?.nodeIds).toEqual(['zone_0'])
  })
})

describe('rooms owe skirting', () => {
  const room = (name: string, skirting: boolean): RoomSpec => ({ name, skirting })
  test.each([
    [
      'no room of a house has any',
      [room('Chambre 2', false), room('Grand salon', false), room('Bureau', false)],
      'No room of the scene',
    ],
    [
      'some rooms have it and this one has not',
      [room('Chambre 2', true), room('Grand salon', false)],
      'Grand salon have no skirting while Chambre 2 do',
    ],
  ])('%s', (_, rooms, wording) => {
    const issues = issuesOf(rooms).filter((issue) => issue.type === 'rooms_no_skirting')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain(wording)
  })

  test.each([
    ['every room has it', [room('Chambre 2', true), room('Grand salon', true)]],
    [
      'wet rooms and garages are not asked for it',
      [room('Salle de bains', false), room('Garage', false)],
    ],
    ['a room or two is not a house', [room('Chambre 2', false), room('Grand salon', false)]],
  ])('%s: nothing to say', (_, rooms) => {
    expect(typesOf(rooms)).not.toContain('rooms_no_skirting')
  })
})

describe('surfaces nobody gave a finish', () => {
  const bed = (name: string, extra: Partial<RoomSpec> = {}): RoomSpec => ({
    name,
    skirting: true,
    ceiling: PAINT,
    ...extra,
  })
  const finding = (rooms: RoomSpec[], type: string) =>
    issuesOf(rooms).find((issue) => issue.type === type)
  const four = (extra: Partial<RoomSpec>, name = 'Robe 2') => [
    bed('Bed 1'),
    bed('Bed 2'),
    bed('Bed 3'),
    bed(name, extra),
  ]

  test('wall faces at the default are named by wall, with where they run and the room they face', () => {
    const issue = finding(four({ walls: null }), 'wall_faces_default')
    expect(issue?.message).toBe(
      'Wall faces at the default, no finish written for them: “wall_r3_0” (Ground): face a 3.90 m facing Robe 2, from 15.05, 0 to 18.95, 0, “wall_r3_1” (Ground): face a 3.90 m facing Robe 2, from 19, 0.05 to 19, 3.95, “wall_r3_2” (Ground): face a 3.90 m facing Robe 2, from 18.95, 4 to 15.05, 4, “wall_r3_3” (Ground): face a 3.90 m facing Robe 2, from 15, 3.95 to 15, 0.05; 4 of 32 wall faces read (15.6 of 126.4 m) show the default.',
    )
    expect(issue?.nodeIds).toEqual(['wall_r3_0', 'wall_r3_1', 'wall_r3_2', 'wall_r3_3'])
    expect(typesOf(four({}))).not.toContain('wall_faces_default')
  })

  test('a face with a painted stretch, or in a room that wrote a finish, is not at the default there', () => {
    const painted = four({ walls: null, regions: [{ wall: 0, v1: 1.2, finish: TILE }] })
    expect(finding(painted, 'wall_faces_default')?.message).toContain('3 of 32')
    expect(finding(painted, 'wall_faces_default')?.nodeIds).toEqual([
      'wall_r3_1',
      'wall_r3_2',
      'wall_r3_3',
    ])
    const halfPainted = four({ walls: null, regions: [{ wall: 0, u1: 1.5, finish: TILE }] })
    expect(finding(halfPainted, 'wall_faces_default')?.message).toContain(
      '“wall_r3_0” (Ground): face a 2.45 m facing Robe 2, from 16.5, 0 to 18.95, 0',
    )
    expect(typesOf(four({ walls: PAINT }))).not.toContain('wall_faces_default')
  })

  describe('a face is read on the wall, whatever room looks at it', () => {
    const wall = (extra: Record<string, unknown>) =>
      WallNode.parse({
        parentId: 'level_0',
        frontSide: 'interior',
        backSide: 'interior',
        ...extra,
      })
    const rooms = [bed('Bed 1'), bed('Bed 2'), bed('Bed 3')]
    const withWalls = (...extra: WallNode[]) =>
      graph(...(Object.values(house(...rooms).nodes) as AnyNode[]), ...extra).nodes as SceneNodes
    const read = (...extra: WallNode[]) =>
      roomCheckIssues(withWalls(...extra), {}).find((issue) => issue.type === 'wall_faces_default')
    const FINISHED = { slots: { a: PAINT, b: PAINT } }

    test('a stub that stands inside a room, on no boundary, is named with the room it stands in', () => {
      const stub = wall({ id: 'wall_stub', name: 'Hall stub', start: [1, 2], end: [2, 2] })
      expect(read(stub)?.message).toBe(
        'Wall faces at the default, no finish written for them: “Hall stub” (Ground): both faces 1.00 m inside Bed 1, from 1, 2 to 2, 2; 2 of 26 wall faces read (2.0 of 96.8 m) show the default.',
      )
      expect(read(stub)?.nodeIds).toEqual(['wall_stub'])
      expect(
        read(wall({ id: 'wall_stub', start: [1, 2], end: [2, 2], ...FINISHED })),
      ).toBeUndefined()
    })

    test('a face with no room on its side is read: a free wall, an outside face', () => {
      const free = wall({ id: 'wall_free', name: 'Garden wall', start: [30, 0], end: [33, 0] })
      expect(read(free)?.message).toContain(
        '“Garden wall” (Ground): both faces 3.00 m with no room on that side, from 30, 0 to 33, 0',
      )
      const outside = roomCheckIssues(
        house(...rooms.slice(0, 2), bed('Bed 3', { outside: null })).nodes as SceneNodes,
        {},
      ).find((issue) => issue.type === 'wall_faces_default')
      expect(outside?.message).toContain('face b 4.00 m with no room on that side')
      expect(outside?.nodeIds).toEqual(['wall_r2_0', 'wall_r2_1', 'wall_r2_2', 'wall_r2_3'])
    })

    test('an outside face shows its assembly cladding, so it is not at the default', () => {
      const clad = (assembly: object) =>
        wall({
          id: 'wall_clad',
          thickness: 0.2524,
          start: [30, 0],
          end: [33, 0],
          backSide: 'exterior',
          assembly,
          slots: { a: PAINT },
        })
      const layers = (finish: boolean) => ({
        layers: [
          { id: 'lining', role: 'lining', thickness: 0.0127 },
          { id: 'studs', role: 'structure', thickness: 0.1397, core: true },
          ...(finish ? [{ id: 'brick', role: 'finish', material: 'brick', thickness: 0.1 }] : []),
        ],
      })
      expect(read(clad(layers(true)))).toBeUndefined()
      expect(read(clad(layers(false)))?.message).toContain('“wall_clad” (Ground): face b 3.00 m')
    })

    test('a stretch of a face inside another wall’s body is no face', () => {
      // The stub runs on into a 0.3 m wall whose centre line is at z = 1: its last 0.15 m is buried.
      const body = wall({
        id: 'wall_body',
        start: [0.5, 1],
        end: [3.5, 1],
        thickness: 0.3,
        ...FINISHED,
      })
      const stub = wall({ id: 'wall_stub', name: 'Hall stub', start: [2, 2.5], end: [2, 1] })
      expect(read(body, stub)?.message).toContain(
        '“Hall stub” (Ground): both faces 1.35 m inside Bed 1, from 2, 2.5 to 2, 1.15',
      )
      // A wall lower than the stub buries nothing of it; one at its own height or more does.
      const low = wall({
        id: 'wall_body',
        start: [0.5, 1],
        end: [3.5, 1],
        thickness: 0.3,
        height: 1,
        ...FINISHED,
      })
      expect(read(low, stub)?.message).toContain('both faces 1.50 m')
      // A stretch that is all buried is not read at all.
      const buried = wall({ id: 'wall_buried', start: [2, 1.1], end: [2, 0.9] })
      expect(read(body, buried)).toBeUndefined()
    })

    test('the end of a wall that overshoots its neighbour is no face, so a finished wall is no finding', () => {
      const long = wall({ id: 'wall_long', start: [0.5, 3.8], end: [3.5, 3.8], ...FINISHED })
      const over = wall({ id: 'wall_over', start: [2, 1.5], end: [2, 3.9], ...FINISHED })
      expect(read(long, over)).toBeUndefined()
      const bare = wall({ id: 'wall_over', start: [2, 1.5], end: [2, 3.9] })
      expect(read(long, bare)?.message).toContain('both faces 2.25 m')
    })
  })

  test('a floor at the default is a finding; a ceiling at its default is normal and is not', () => {
    const rooms = [
      bed('Bed 1'),
      bed('Bed 2'),
      bed('Bed 3'),
      bed('Robe 2', { floor: null, ceiling: 'default' }),
    ]
    expect(finding(rooms, 'rooms_floors_default')?.message).toBe(
      'Floors at the default, no finish written for them: Robe 2; the other 3 rooms read show a finish.',
    )
    expect(typesOf(rooms).filter((type) => type.includes('ceiling'))).toEqual([])
  })

  test('a room whose floor is a drawn slab with a surface of its own has a floor', () => {
    const drawn = bed('Garage', { floor: null, under: 'drawn' })
    expect(typesOf([bed('Bed 1'), bed('Bed 2'), bed('Bed 3'), drawn])).toContain(
      'rooms_floors_default',
    )
    const slab = house(bed('Bed 1'), bed('Bed 2'), bed('Bed 3'), drawn).nodes
    const painted = {
      ...slab,
      slab_3: { ...slab.slab_3, slots: { surface: PARQUET } },
    }
    expect(roomCheckIssues(painted as SceneNodes, {}).map((issue) => issue.type)).not.toContain(
      'rooms_floors_default',
    )
  })

  test('every room at the default is said when there are three, and not for a room or two', () => {
    const bare = (name: string): RoomSpec => ({
      name,
      floor: null,
      walls: null,
      outside: null,
      ceiling: 'default',
    })
    const three = issuesOf([bare('Bed 1'), bare('Bed 2'), bare('Bed 3')])
    expect(three.find((issue) => issue.type === 'rooms_floors_default')?.message).toBe(
      'Floors at the default, no finish written for them: Bed 1, Bed 2, Bed 3 (all 3 rooms read).',
    )
    expect(three.find((issue) => issue.type === 'wall_faces_default')?.message).toContain(
      '24 of 24 wall faces read (94.8 of 94.8 m) show the default',
    )
    expect(three.filter((issue) => issue.type.includes('ceiling'))).toEqual([])
    const two = typesOf([bare('Bed 1'), bare('Bed 2')])
    for (const type of ['wall_faces_default', 'rooms_floors_default'])
      expect(two).not.toContain(type)
  })

  test('an outdoor room is owed no floor, and its walls are read like any wall', () => {
    const rooms = [
      bed('Bed 1'),
      bed('Bed 2'),
      bed('Bed 3'),
      { name: 'Alfresco', floor: null, walls: null } as RoomSpec,
    ]
    expect(typesOf(rooms)).not.toContain('rooms_floors_default')
    expect(finding(rooms, 'wall_faces_default')?.message).toContain('facing Alfresco')
  })
})

describe('skirting on part of a room', () => {
  const bed = (name: string, skirting: RoomSpec['skirting']): RoomSpec => ({ name, skirting })

  test('a room skirted on some of its faces is named with how many, and is not a room with none', () => {
    const issues = issuesOf([bed('Bed 1', true), bed('Bed 2', 'some'), bed('Bed 3', true)])
    expect(issues.find((issue) => issue.type === 'rooms_skirting_partial')).toMatchObject({
      message:
        'Skirting is on part of the wall faces of Bed 2 (2 of 4 faces): 1 room of the 3 rooms that owe it.',
      nodeIds: ['zone_1'],
    })
    expect(issues.map((issue) => issue.type)).not.toContain('rooms_no_skirting')
  })

  test('every face, or none, is not part', () => {
    expect(typesOf([bed('Bed 1', true), bed('Bed 2', true), bed('Bed 3', true)])).not.toContain(
      'rooms_skirting_partial',
    )
    const none = typesOf([bed('Bed 1', false), bed('Bed 2', false), bed('Bed 3', false)])
    expect(none).toContain('rooms_no_skirting')
    expect(none).not.toContain('rooms_skirting_partial')
  })

  test('a room that owes none (a robe, a garage) is not read', () => {
    expect(
      typesOf([bed('Bed 1', true), bed('Robe 1', 'some'), bed('Garage', 'some')]),
    ).not.toContain('rooms_skirting_partial')
  })
})

describe('a room with nothing under it', () => {
  const room = (name: string, under?: RoomSpec['under']): RoomSpec => ({ name, under })
  const issue = (rooms: RoomSpec[]) => issuesOf(rooms).find((i) => i.type === 'room_no_floor')

  test('no plate and no slab under it is named, with its level', () => {
    expect(issue([room('Bed 1'), room('Bed 2', 'none')])).toMatchObject({
      message: expect.stringContaining('No floor plate or slab is under Bed 2 (Ground)'),
      nodeIds: ['zone_1'],
    })
  })

  test('a drawn slab it was taken from is a floor: a garage slab lowered by hand', () => {
    expect(issue([room('Bed 1'), room('Garage', 'drawn')])).toBeUndefined()
  })

  test('an outdoor room is not read', () => {
    expect(issue([room('Bed 1'), room('Alfresco', 'none')])).toBeUndefined()
  })
})
