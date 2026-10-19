import { describe, expect, test } from 'bun:test'
import { FURNISH_ROOM_SETS, FURNISHED_ROOM_TYPES } from '../agent-tools/furnish-room'
import { type AssetInput, BuildingNode, LevelNode, ZoneNode } from '../schema'
import { furnishRoom } from './furnish-room'
import type { SceneNodes } from './types'

const IDS = [
  'double-bed',
  'single-bed',
  'bedside-table',
  'dresser',
  'closet',
  'kitchen',
  'kitchen-counter',
  'stove',
  'fridge',
  'toilet',
  'bathroom-sink',
  'bathtub',
  'shower-square',
  'sofa',
  'coffee-table',
  'livingroom-chair',
  'tv-stand',
  'dining-table',
  'dining-chair',
  'washing-machine',
  'drying-rack',
  'coat-rack',
]
// Small pieces, so that only the layout decides what a room takes.
const CATALOG: AssetInput[] = IDS.map((id) => ({
  id,
  name: id,
  category: 'furniture',
  thumbnail: '/items/a/thumbnail.webp',
  src: '/items/a/model.glb',
  dimensions: [0.5, 0.5, 0.4],
}))

/** What the set of a room type names: its entries, between its label and the next one. */
function namedIn(roomType: string) {
  const labels: Record<string, string> = {
    entry: 'entry and hallway',
    hallway: 'entry and hallway',
  }
  const label = `${labels[roomType] ?? roomType}: `
  const start = FURNISH_ROOM_SETS.indexOf(label)
  const rest = FURNISH_ROOM_SETS.slice(start + label.length)
  const segment = rest.slice(0, rest.indexOf(';') >= 0 ? rest.indexOf(';') : rest.length)
  return IDS.filter((id) => new RegExp(`(^|[ ,])${id}([ ,.(]|$)`).test(segment))
}

function placedIn(roomType: (typeof FURNISHED_ROOM_TYPES)[number], width: number, depth: number) {
  const building = BuildingNode.parse({ id: 'building_a', children: ['level_0'] })
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: building.id,
    level: 0,
    children: ['zone_a'],
  })
  const zone = ZoneNode.parse({
    id: 'zone_a',
    parentId: level.id,
    name: 'Room',
    polygon: [
      [0, 0],
      [width, 0],
      [width, depth],
      [0, depth],
    ],
  })
  const nodes = { [building.id]: building, [level.id]: level, [zone.id]: zone } as SceneNodes
  const { result } = furnishRoom(
    nodes,
    { zoneId: zone.id, roomType },
    {
      activeLevelId: null,
      catalog: CATALOG,
    },
  )
  return (result as { pieces: string[] }).pieces.map((piece) => piece.split(' (')[0]!)
}

describe('the set furnish_room says it places is the set its layout places', () => {
  test.each(FURNISHED_ROOM_TYPES)('%s', (roomType) => {
    const placed = new Set(
      [
        [2, 1.5],
        [3, 2],
        [3, 2.5],
        [3.3, 3.3],
        [5, 3],
        [8, 6],
      ].flatMap(([width, depth]) => placedIn(roomType, width!, depth!)),
    )
    expect([...placed].sort()).toEqual(namedIn(roomType).sort())
  })
})
