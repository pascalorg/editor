import { describe, expect, test } from 'bun:test'
import type { AnyNode, SceneMaterial, ZoneNode } from '../schema'
import { paintedKitchenScene } from './__fixtures__/room-cases'
import { changedFinishes, describeFinish, levelFinishes, roomFinishes } from './room-finishes'
import { nodesOnLevel } from './scene-queries'

const scene = () => paintedKitchenScene().nodes as Record<string, AnyNode>

describe('describeFinish', () => {
  test('nothing written, an empty string and null read as the default', () => {
    for (const none of [undefined, null, ''])
      expect(describeFinish(none)).toEqual({ ref: null, name: 'default' })
  })

  test('a library ref reads as its name, kind and colour', () => {
    expect(describeFinish('library:preset-softwhite')).toEqual({
      ref: 'library:preset-softwhite',
      name: 'Soft White',
      kind: 'colors',
      color: '#ebe7df',
    })
  })

  test('a textured library material reads the preview colour the library gives it', () => {
    expect(describeFinish('library:wood-floorplank1')).toMatchObject({
      name: 'Floor Plank 1',
      kind: 'wood',
      color: '#bf8552',
    })
  })

  test('a ref the library does not know, and a bare word, read as themselves', () => {
    expect(describeFinish('library:nowhere')).toEqual({
      ref: 'library:nowhere',
      name: 'library:nowhere',
    })
    expect(describeFinish('wood')).toEqual({ ref: 'wood', name: 'wood' })
  })

  test('a scene material reads as its name and colour; one the scene lacks reads as its ref', () => {
    const limewash: SceneMaterial = {
      id: 'mat_lime',
      name: 'Warm limewash',
      material: {
        properties: {
          color: '#cfc3ae',
          roughness: 0.8,
          metalness: 0,
          opacity: 1,
          transparent: false,
          side: 'front',
        },
      },
    }
    expect(describeFinish('scene:mat_lime', { mat_lime: limewash })).toEqual({
      ref: 'scene:mat_lime',
      name: 'Warm limewash',
      color: '#cfc3ae',
    })
    expect(describeFinish('scene:mat_lime')).toEqual({
      ref: 'scene:mat_lime',
      name: 'scene:mat_lime',
    })
  })

  test('an inline material reads as one, with the colour it carries', () => {
    expect(describeFinish({ properties: { color: '#112233' } })).toEqual({
      ref: null,
      name: 'an inline material',
      color: '#112233',
    })
    expect(describeFinish({ material: { properties: { color: '#445566' } } })).toMatchObject({
      color: '#445566',
    })
    expect(describeFinish({})).toEqual({ ref: null, name: 'an inline material' })
  })
})

describe('roomFinishes', () => {
  test('a room with no floor reads none, and one with no ceiling reads none', () => {
    const nodes = scene()
    nodes.zone_pantry = { ...(nodes.zone_pantry as ZoneNode), hasFloor: false, hasCeiling: false }
    const content = nodesOnLevel(nodes, 'level_rooms')
    const shown = roomFinishes(nodes, nodes.zone_pantry as ZoneNode, content)
    expect(shown.floor).toBeUndefined()
    expect(shown.ceiling).toBeUndefined()
    expect(shown.walls?.faces).toBe(2)
  })

  test('the painted parts of a floor are named apart and leave the finish the room shows alone', () => {
    const nodes = scene()
    nodes.zone_kitchen = {
      ...(nodes.zone_kitchen as ZoneNode),
      floor: {
        finish: 'library:preset-sand',
        regions: [
          {
            id: 'rug',
            polygon: [
              [1, 1],
              [2, 1],
              [2, 2],
            ],
            finish: 'library:preset-cream',
          },
        ],
      },
    }
    const shown = roomFinishes(
      nodes,
      nodes.zone_kitchen as ZoneNode,
      nodesOnLevel(nodes, 'level_rooms'),
    )
    expect(shown.floor).toMatchObject({ ref: 'library:preset-sand', name: 'Sand' })
    expect(shown.floor?.regions).toEqual([
      { id: 'rug', finish: describeFinish('library:preset-cream') },
    ])
    const palette = levelFinishes(nodes, 'level_rooms')
    expect(palette?.floors?.[0]).toEqual({
      finish: describeFinish('library:preset-sand'),
      rooms: ['Kitchen'],
    })
  })

  test('a wall with a finish of its own shows it where the room gives none', () => {
    const nodes = scene()
    nodes.zone_kitchen = {
      ...(nodes.zone_kitchen as ZoneNode),
      wallMaterial: undefined,
      wallOverrides: [],
    }
    nodes.wall_west = {
      ...(nodes.wall_west as AnyNode),
      slots: { a: 'library:preset-sage', b: 'library:preset-sage' },
    } as AnyNode
    const shown = roomFinishes(
      nodes,
      nodes.zone_kitchen as ZoneNode,
      nodesOnLevel(nodes, 'level_rooms'),
    )
    expect(shown.walls?.faces).toBe(4)
    expect(shown.walls?.finishes).toEqual([
      { finish: { ref: null, name: 'default' }, faces: 3 },
      { finish: describeFinish('library:preset-sage'), faces: 1 },
    ])
  })
})

describe('a floor plate that carries a surface of its own', () => {
  const withPlateSurface = (surface: Record<string, unknown>) => {
    const nodes = scene()
    const plate = Object.values(nodes).find(
      (node) => node.type === 'slab' && node.plateRole === 'base',
    )!
    nodes[plate.id] = { ...plate, ...surface } as AnyNode
    return nodes
  }

  test('it shows in the rooms that have no floor finish of their own, and not in those that do', () => {
    const nodes = withPlateSurface({ slots: { surface: 'library:preset-cream' } })
    nodes.zone_kitchen = {
      ...(nodes.zone_kitchen as ZoneNode),
      floor: { finish: 'library:preset-sand' },
    }
    const floors = levelFinishes(nodes, 'level_rooms')?.floors
    expect(floors).toEqual([
      { finish: describeFinish('library:preset-sand'), rooms: ['Kitchen'] },
      { finish: describeFinish('library:preset-cream'), rooms: ['Room 1'] },
    ])
  })

  test('an older plate reads by its preset, and its inline material as one', () => {
    const preset = withPlateSurface({ materialPreset: 'library:preset-sage' })
    expect(levelFinishes(preset, 'level_rooms')?.floors?.[0]?.finish.name).toBe('Sage')
    const inline = withPlateSurface({ material: { properties: { color: '#abcdef' } } })
    expect(levelFinishes(inline, 'level_rooms')?.floors?.[0]?.finish).toEqual({
      ref: null,
      name: 'an inline material',
      color: '#abcdef',
    })
  })
})

describe('levelFinishes', () => {
  test('a level with no room, and a node that is no level, read nothing', () => {
    const nodes = scene()
    for (const id of Object.keys(nodes)) if (nodes[id]?.type === 'zone') delete nodes[id]
    expect(levelFinishes(nodes, 'level_rooms')).toBeNull()
    expect(levelFinishes(nodes, 'wall_north')).toBeNull()
  })

  test("rooms are listed in the level's order under each finish, and a zone that is no room is left out", () => {
    const nodes = scene()
    nodes.zone_site = {
      ...(nodes.zone_pantry as ZoneNode),
      id: 'zone_site',
      name: 'Lot',
      spaceRole: 'generic',
    } as ZoneNode
    const level = nodes.level_rooms as AnyNode & { children: string[] }
    nodes.level_rooms = { ...level, children: [...level.children, 'zone_site'] } as AnyNode
    const palette = levelFinishes(nodes, 'level_rooms')
    expect(palette?.floors).toEqual([
      { finish: { ref: null, name: 'default' }, rooms: ['Kitchen', 'Room 1'] },
    ])
    expect(JSON.stringify(palette)).not.toContain('Lot')
  })
})

describe('levelFinishes by surface', () => {
  test('only the surfaces asked for are read, and none read where no room shows them', () => {
    const nodes = scene()
    expect(Object.keys(levelFinishes(nodes, 'level_rooms', undefined, ['walls']) ?? {})).toEqual([
      'levelId',
      'walls',
    ])
    expect(Object.keys(levelFinishes(nodes, 'level_rooms') ?? {})).toEqual([
      'levelId',
      'floors',
      'walls',
      'ceilings',
    ])
    nodes.zone_kitchen = { ...(nodes.zone_kitchen as ZoneNode), hasCeiling: false }
    nodes.zone_pantry = { ...(nodes.zone_pantry as ZoneNode), hasCeiling: false }
    expect(levelFinishes(nodes, 'level_rooms', undefined, ['ceilings'])).toBeNull()
  })
})

describe('changedFinishes', () => {
  const namedRooms = (shown: ReturnType<typeof changedFinishes>) =>
    shown.flatMap((level) =>
      [level.floors, level.walls, level.ceilings].flatMap((groups) =>
        (groups ?? []).flatMap((group) => group.rooms.map((room) => room.replace(/ \(.*\)$/, ''))),
      ),
    )

  test('reads the rooms asked for and no other, the surface asked for and no other', () => {
    const shown = changedFinishes(scene(), { walls: ['zone_pantry'] })
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ levelId: 'level_rooms' })
    expect(Object.keys(shown[0]!)).toEqual(['levelId', 'walls'])
    expect(new Set(namedRooms(shown))).toEqual(new Set(['Room 1']))
    expect(JSON.stringify(shown)).not.toContain('Kitchen')
  })

  test('a room that shows nothing written is no row: the default is not answered', () => {
    expect(
      changedFinishes(scene(), { floors: ['zone_kitchen'], ceilings: ['zone_kitchen'] }),
    ).toEqual([])
    expect(JSON.stringify(changedFinishes(scene(), { walls: ['zone_kitchen'] }))).not.toContain(
      '"default"',
    )
  })

  test('each surface reads its own rooms, answered together on the level', () => {
    const nodes = scene()
    nodes.zone_kitchen = {
      ...(nodes.zone_kitchen as ZoneNode),
      floor: { finish: 'library:wood-floorplank1' },
    } as ZoneNode
    const shown = changedFinishes(nodes, { floors: ['zone_kitchen'], walls: ['zone_pantry'] })
    expect(shown).toHaveLength(1)
    expect(shown[0]?.floors?.map((group) => group.rooms)).toEqual([['Kitchen']])
    expect(
      new Set(shown[0]?.walls?.flatMap((group) => group.rooms.map((room) => room.slice(0, 6)))),
    ).toEqual(new Set(['Room 1']))
  })

  test('an id that is no room reads nothing', () => {
    expect(changedFinishes(scene(), { walls: ['wall_north', 'zone_missing'] })).toEqual([])
  })
})
