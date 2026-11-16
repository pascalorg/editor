import { describe, expect, test } from 'bun:test'
import { LevelNode, roomCounts, type SceneGraph, ZoneNode } from '../index'

const square: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const room = (name = 'Living room', overrides: Record<string, unknown> = {}) =>
  ZoneNode.parse({ name, polygon: square, spaceRole: 'room', ...overrides })

function graph(levelRooms: ZoneNode[][]): SceneGraph {
  const nodes: SceneGraph['nodes'] = {}
  const rootNodeIds = levelRooms.map((zones) => {
    const level = LevelNode.parse({ children: zones.map((zone) => zone.id) })
    nodes[level.id] = level
    for (const zone of zones) nodes[zone.id] = { ...zone, parentId: level.id }
    return level.id
  })
  return { nodes, rootNodeIds }
}

describe('roomCounts', () => {
  test('empty graphs have no available bedroom or area figure', () => {
    expect(roomCounts(graph([]))).toEqual({
      rooms: 0,
      bedrooms: null,
      modelledAreaM2: null,
      unclassifiedZones: 0,
    })
  })

  test.each([
    'Bedroom 1',
    'Primary bedroom',
    'Chambre',
    'Chambre à coucher',
    'Guest room',
    "Kids' room",
    'Kids’ room',
  ])('%s is a bedroom', (name) => {
    expect(roomCounts(graph([[room(name)]]))).toMatchObject({ rooms: 1, bedrooms: 1 })
  })

  test.each([
    'Bedroom closet',
    'Bed 1 ensuite',
    'Bedroom hallway',
    'Hall des chambres',
    'Unknown',
    'Room 1',
  ])('%s is not a bedroom', (name) => {
    expect(roomCounts(graph([[room(name)]]))).toMatchObject({ rooms: 1, bedrooms: 0 })
  })

  test('subtracts holes before union, allowing another room to fill a hole', () => {
    const hole: [number, number][] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]
    const shell = room('Living room', { holes: [hole] })
    expect(roomCounts(graph([[shell]])).modelledAreaM2).toBe(12)
    expect(roomCounts(graph([[shell, room('Office', { polygon: hole })]])).modelledAreaM2).toBe(16)
  })

  test('unions overlapping rooms on each level, then sums levels', () => {
    const plan = () => [room(), room('Office', { polygon: square.map(([x, z]) => [x + 2, z]) })]
    expect(roomCounts(graph([plan()]))).toMatchObject({ rooms: 2, modelledAreaM2: 24 })
    expect(roomCounts(graph([plan(), plan()]))).toMatchObject({ rooms: 4, modelledAreaM2: 48 })
  })

  test('outdoor and open rooms count as rooms but contribute no indoor area', () => {
    const outdoor = ['porch', 'deck', 'patio'].map((roomType) => room('Outside', { roomType }))
    outdoor.push(room('Void'), room('Open room', { enclosureStatus: 'open' }))
    expect(roomCounts(graph([outdoor]))).toEqual({
      rooms: 5,
      bedrooms: 0,
      modelledAreaM2: null,
      unclassifiedZones: 0,
    })
    expect(roomCounts(graph([[...outdoor, room()]]))).toMatchObject({ modelledAreaM2: 16 })
  })

  test('generic and legacy default zones are unclassified, even when named Bedroom', () => {
    const legacy = ZoneNode.parse({ name: 'Bedroom', polygon: square })
    const explicit = room('Bedroom', { spaceRole: 'generic' })
    expect(roomCounts(graph([[legacy, explicit]]))).toEqual({
      rooms: 0,
      bedrooms: null,
      modelledAreaM2: null,
      unclassifiedZones: 2,
    })
  })

  test('ignores hidden zones, hidden subtrees and zones detached from roots', () => {
    const scene = graph([[room('Bedroom', { visible: false }), room()], [room('Bedroom')]])
    scene.nodes[scene.rootNodeIds[1]!]!.visible = false
    const detached = room('Bedroom')
    scene.nodes[detached.id] = detached
    expect(roomCounts(scene)).toEqual({
      rooms: 1,
      bedrooms: 0,
      modelledAreaM2: 16,
      unclassifiedZones: 0,
    })
  })
})

test('a hidden site keeps the bedrooms in its visible buildings counted', async () => {
  const { SiteNode, BuildingNode } = await import('../index')
  const scene = graph([[room('Bedroom')]])
  const building = BuildingNode.parse({ children: scene.rootNodeIds })
  for (const id of scene.rootNodeIds) scene.nodes[id]!.parentId = building.id
  const site = SiteNode.parse({ visible: false, children: [building.id] })
  building.parentId = site.id
  scene.nodes[site.id] = site
  scene.nodes[building.id] = building
  scene.rootNodeIds = [site.id]
  expect(roomCounts(scene)).toMatchObject({ rooms: 1, bedrooms: 1, modelledAreaM2: 16 })
})
