import { describe, expect, test } from 'bun:test'
import { BuildingNode, ItemNode, LevelNode, WallNode, ZoneNode } from '../schema'
import { roomCheckIssues } from './room-checks'
import type { SceneNodes } from './types'
import { wallItemFaceIssues } from './wall-item-faces'

/**
 * Bed 3 (z 0 to 3) and the Garage (z 3 to 6) share a wall on z = 3 that runs along +x: its face `a`
 * (the item's `front`) looks into the Garage, its face `b` (`back`) into Bed 3. The south wall, on z = 0,
 * has Bed 3 on its face `a` and the outside on its face `b`. Linen is a room elsewhere.
 */
const scene = (items: Record<string, unknown>[]): SceneNodes => {
  const asset = (name: string) => ({
    id: name,
    name,
    category: 'art',
    thumbnail: '/t.webp',
    src: 'asset://art',
    dimensions: [0.6, 0.8, 0.03],
    attachTo: 'wall-side',
  })
  const hosted = items.map((item, index) =>
    ItemNode.parse({
      id: `item_${index}`,
      parentId: item.wall ?? 'wall_mid',
      wallId: item.wall ?? 'wall_mid',
      position: [2, 1.5, 0],
      side: item.side,
      name: item.name,
      metadata: item.metadata ?? {},
      asset: asset(String(item.name)),
    }),
  )
  const walls = [
    WallNode.parse({
      id: 'wall_mid',
      parentId: 'level_1',
      name: 'Party wall',
      start: [0, 3],
      end: [4, 3],
      children: hosted.filter((h) => h.parentId === 'wall_mid').map((h) => h.id),
    }),
    WallNode.parse({
      id: 'wall_south',
      parentId: 'level_1',
      name: 'South wall',
      start: [0, 0],
      end: [4, 0],
      children: hosted.filter((h) => h.parentId === 'wall_south').map((h) => h.id),
    }),
  ]
  const zone = (id: string, name: string, polygon: [number, number][], walls: string[]) =>
    ZoneNode.parse({
      id,
      parentId: 'level_1',
      name,
      polygon,
      spaceRole: 'room',
      boundaryWallIds: walls,
    })
  const nodes = [
    BuildingNode.parse({ id: 'building_1', children: ['level_1'] }),
    LevelNode.parse({
      id: 'level_1',
      parentId: 'building_1',
      level: 0,
      children: ['wall_mid', 'wall_south', 'zone_bed', 'zone_garage', 'zone_linen'],
    }),
    ...walls,
    zone(
      'zone_bed',
      'Bed 3',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      ['wall_mid', 'wall_south'],
    ),
    zone(
      'zone_garage',
      'Garage',
      [
        [0, 3],
        [4, 3],
        [4, 6],
        [0, 6],
      ],
      ['wall_mid'],
    ),
    zone(
      'zone_linen',
      'Linen',
      [
        [6, 0],
        [8, 0],
        [8, 2],
        [6, 2],
      ],
      [],
    ),
    ...hosted,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as SceneNodes
}

const found = (items: Record<string, unknown>[]) => wallItemFaceIssues(scene(items))

describe('a piece hung on the face that looks into another room than the one it names', () => {
  test('an art print named for Bed 3 on the face that looks into the Garage is a warning that names the item, the face and both rooms', () => {
    const [issue] = found([{ name: 'Hot-air balloon art print (Bed 3)', side: 'front' }])
    expect(issue).toMatchObject({ type: 'room_wall_item_wrong_face', severity: 'warning' })
    expect(issue!.message).toBe(
      '“Hot-air balloon art print (Bed 3)” hangs on the front face of “Party wall”, which looks into “Garage”, but it names “Bed 3”, the room on the other face.',
    )
    expect(issue!.nodeIds).toEqual(['item_0', 'wall_mid', 'zone_garage', 'zone_bed'])
  })

  test('the same print on the other face, or one that names no room, says nothing', () => {
    expect(found([{ name: 'Hot-air balloon art print (Bed 3)', side: 'back' }])).toHaveLength(0)
    expect(found([{ name: 'Hot-air balloon art print', side: 'front' }])).toHaveLength(0)
  })

  test('the reason it was placed names the room as the name does', () => {
    expect(
      found([
        { name: 'Mirror', side: 'front', metadata: { reason: 'Mirror over the dresser in Bed 3' } },
      ]),
    ).toHaveLength(1)
  })

  test('a word that is also a room elsewhere is no claim: linen curtains are not for the Linen room', () => {
    expect(found([{ name: 'Sheer linen curtains', side: 'front' }])).toHaveLength(0)
  })

  test('cladding named for a room is the facade of its wall, whichever face it is on', () => {
    expect(found([{ name: 'Bed 3 — vertical cedar cladding', side: 'front' }])).toHaveLength(0)
  })

  test('a curtain named for Bed 3 on the face of the south wall that looks outside is a warning that says outside', () => {
    const [issue] = found([{ name: 'Bed 3 curtains', side: 'back', wall: 'wall_south' }])
    expect(issue!.message).toBe(
      '“Bed 3 curtains” hangs on the back face of “South wall”, which looks into the outside, but it names “Bed 3”, the room on the other face.',
    )
    expect(found([{ name: 'Bed 3 curtains', side: 'front', wall: 'wall_south' }])).toHaveLength(0)
  })

  test('it is one of the room checks', () => {
    const types = roomCheckIssues(scene([{ name: 'Art print (Bed 3)', side: 'front' }])).map(
      (issue) => issue.type,
    )
    expect(types).toContain('room_wall_item_wrong_face')
  })
})
