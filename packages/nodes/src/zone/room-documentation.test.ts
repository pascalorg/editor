import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, ZoneNode } from '@pascal-app/core'
import { buildRoomFloorplanSchedule } from './room-documentation'

function room(overrides: Partial<ZoneNode> = {}) {
  return ZoneNode.parse({
    id: 'zone_room',
    parentId: 'level_main',
    name: 'Office',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    spaceRole: 'room',
    roomNumber: '101',
    floorFinish: 'Timber',
    wallFinish: 'Paint',
    ceilingFinish: 'ACT',
    ceilingHeight: 2.7,
    occupancy: 'Business',
    ...overrides,
  })
}

function nodesFor(zones: ZoneNode[]) {
  const level = LevelNode.parse({
    id: 'level_main',
    children: zones.map((zone) => zone.id),
  })
  return Object.fromEntries([level, ...zones].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
}

describe('buildRoomFloorplanSchedule', () => {
  test('includes only architectural rooms and formats their documented values', () => {
    const office = room({ id: 'zone_office', roomNumber: '102' })
    const lobby = room({
      id: 'zone_lobby',
      name: 'Lobby',
      roomNumber: '101',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 2],
        [0, 2],
      ],
      floorFinish: '',
    })
    const courtyard = room({
      id: 'zone_courtyard',
      name: 'Courtyard',
      roomNumber: '100',
      spaceRole: 'generic',
    })
    const zones = [office, lobby, courtyard]

    const schedule = buildRoomFloorplanSchedule({
      siblings: zones,
      nodes: nodesFor(zones),
      levelId: 'level_main',
      unit: 'metric',
    })

    expect(schedule?.title).toBe('ROOM SCHEDULE')
    expect(schedule?.rows.map((row) => row.id)).toEqual(['zone_lobby', 'zone_office'])
    expect(schedule?.rows[0]?.cells).toMatchObject({
      number: '101',
      name: 'Lobby',
      area: '10.00 m²',
      floorFinish: '—',
      wallFinish: 'Paint',
      ceilingFinish: 'ACT',
      ceilingHeight: '2700',
      occupancy: 'Business',
      enclosure: 'Open',
    })
  })

  test('formats imperial schedule values', () => {
    const office = room({
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    })
    const schedule = buildRoomFloorplanSchedule({
      siblings: [office],
      nodes: nodesFor([office]),
      levelId: 'level_main',
      unit: 'imperial',
    })

    expect(schedule?.rows[0]?.cells).toMatchObject({
      area: '10.8 ft²',
      ceilingHeight: `8'-10 5/16"`,
    })
  })

  test('reports missing and duplicate room numbers plus unproven enclosure claims', () => {
    const unnumbered = room({
      id: 'zone_unnumbered',
      name: 'Storage',
      roomNumber: '',
    })
    const duplicateA = room({ id: 'zone_a', roomNumber: 'A01' })
    const duplicateB = room({
      id: 'zone_b',
      name: 'Meeting',
      roomNumber: 'a01',
      enclosureStatus: 'enclosed',
    })
    const zones = [unnumbered, duplicateA, duplicateB]
    const schedule = buildRoomFloorplanSchedule({
      siblings: zones,
      nodes: nodesFor(zones),
      levelId: 'level_main',
      unit: 'metric',
    })

    expect(schedule?.issues).toEqual([
      'Room Storage has no room number',
      'Room a01 is marked enclosed but not proven',
      'Duplicate room number A01 (2 rooms)',
    ])
  })

  test('returns no schedule when the level has no architectural rooms', () => {
    const zone = room({ spaceRole: 'generic' })
    expect(
      buildRoomFloorplanSchedule({
        siblings: [zone],
        nodes: nodesFor([zone]),
        levelId: 'level_main',
        unit: 'metric',
      }),
    ).toBeNull()
  })
})
