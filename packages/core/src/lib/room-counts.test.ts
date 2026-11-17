import { describe, expect, test } from 'bun:test'
import { readRooms } from '../agent-operations'
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

  test('legacy and generic level zones count as rooms, like the viewer list', () => {
    const legacy = ZoneNode.parse({ name: 'Bedroom', polygon: square })
    const explicit = room('Bedroom', { spaceRole: 'generic' })
    expect(roomCounts(graph([[legacy, explicit]]))).toEqual({
      rooms: 2,
      bedrooms: 2,
      modelledAreaM2: 16,
      unclassifiedZones: 0,
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

const translatedBedrooms = [
  ['Dormitorio 1', ['Armario del dormitorio', 'Pasillo del dormitorio', 'Baño del dormitorio']],
  [
    'Schlafzimmer 1',
    ['Schlafzimmer Ankleidezimmer', 'Schlafzimmer Flur', 'Schlafzimmer Badezimmer'],
  ],
  [
    'Camera da letto 1',
    [
      'Guardaroba della camera da letto',
      'Corridoio della camera da letto',
      'Bagno della camera da letto',
    ],
  ],
  [
    'Quarto 1',
    ['Armário do quarto', 'Corredor do quarto', 'Banheiro do quarto', 'Quarto de banho'],
  ],
  ['Slaapkamer 1', ['Slaapkamer inloopkast', 'Slaapkamer gang', 'Slaapkamer badkamer']],
  ['Спальня 1', ['Гардеробная спальни', 'Коридор спальни', 'Ванная спальни']],
  ['卧室1', ['卧室衣柜', '卧室走廊', '卧室卫生间']],
  ['寝室1', ['寝室のクローゼット', '寝室の廊下', '寝室の浴室']],
] as const

test.each(translatedBedrooms)(
  '%s is a bedroom in facts and room readings; its annexes are not',
  (name, annexes) => {
    expect(roomCounts(graph([[room(name)]]))).toMatchObject({ bedrooms: 1 })
    for (const annex of annexes)
      expect(roomCounts(graph([[room(annex)]]))).toMatchObject({ bedrooms: 0 })
    const readings = readRooms(graph([[room(name), ...annexes.map((annex) => room(annex))]]).nodes)
    expect(readings.find((reading) => reading.name === name)?.use).toBe('bedroom')
    for (const annex of annexes)
      expect(readings.find((reading) => reading.name === annex)?.use).not.toBe('bedroom')
  },
)

// Pins name classifications before this change.
test.each([
  ['Bedroom 1', 'bedroom'],
  ['Primary bedroom', 'bedroom'],
  ['Chambre', 'bedroom'],
  ['Chambre à coucher', 'bedroom'],
  ['Nursery', 'bedroom'],
  ['Dortoir', 'bedroom'],
  ['Dormitory', 'bedroom'],
  ['Suite parentale', 'bedroom'],
  ['Bathroom', 'bathroom'],
  ['Family bathroom', 'bathroom'],
  ['Salle de bains', 'bathroom'],
  ['Salle d’eau', 'bathroom'],
  ['WC', 'bathroom'],
  ['Douche', 'bathroom'],
  ['Sanitaire', 'bathroom'],
  ['Lavabo', 'bathroom'],
  ['Kitchen', 'kitchen'],
  ['Pantry', 'kitchen'],
  ['Cuisine', 'kitchen'],
  ['Garde-manger', 'kitchen'],
  ['Dining room', 'dining'],
  ['Salle à manger', 'dining'],
  ['Living room', 'living'],
  ['Lounge', 'living'],
  ['Family room', 'living'],
  ['Sitting room', 'living'],
  ['Salon', 'living'],
  ['Séjour', 'living'],
  ['Pièce de vie', 'living'],
  ['Great room', 'living'],
  ['Office', 'office'],
  ['Study', 'office'],
  ['Den', 'office'],
  ['Library', 'office'],
  ['Workspace', 'office'],
  ['Bureau', 'office'],
  ['Bibliothèque', 'office'],
  ['Hall', 'hallway'],
  ['Hall des chambres', 'hallway'],
  ['Couloir', 'hallway'],
  ['Palier', 'hallway'],
  ['Vestibule', 'hallway'],
  ['Galerie', 'hallway'],
  ['Entrée', 'hallway'],
  ['Corridor', 'hallway'],
  ['Landing', 'hallway'],
  ['Foyer', 'hallway'],
  ['Passage', 'hallway'],
  ['Dégagement', 'hallway'],
  ['Study lobby', 'hallway'],
  ['Kitchen hall 2', 'hallway'],
  ['Laundry', 'laundry'],
  ['Buanderie', 'laundry'],
  ['Lingerie', 'laundry'],
  ['Utility', 'laundry'],
  ['Laverie', 'laundry'],
  ['Garage', 'garage'],
  ['Carport', 'garage'],
  ['Parking', 'garage'],
  ['Dressing', 'other'],
  ['Walk-in', 'other'],
  ['Closet', 'other'],
  ['Wardrobe', 'other'],
  ['Storage', 'other'],
  ['Rangement', 'other'],
  ['Placard', 'other'],
  ['Cellier', 'other'],
  ['Mud room', 'other'],
  ['Bed 1 Entry', 'hallway'],
  ['Bed 3 WIR', 'other'],
  ['Bedroom ensuite', 'bathroom'],
  ['Chambre placard', 'other'],
  ['Unknown', 'other'],
  ['Room 1', 'other'],
  ['Atelier', 'other'],
  ['Guest room office', 'office'],
  ['Guest room garage', 'garage'],
  ['Kids room family', 'living'],
  ['Guest room cuisine', 'kitchen'],
  ['Kids room bureau', 'office'],
  ['Dormitorio office', 'office'],
  ['Schlafzimmer garage', 'garage'],
  ['Quarto cuisine', 'kitchen'],
] as const)('%s preserves its original name classification', (name, expected) => {
  expect(readRooms(graph([[room(name)]]).nodes)[0]?.use).toBe(expected)
})

test('Quarto is the Portuguese bedroom noun', () => {
  expect(readRooms(graph([[room('Quarto')]]).nodes)[0]?.use).toBe('bedroom')
})

test.each([0, 2, 4])(
  'wall-detected rooms with %s stored vertices count with their effective outline',
  async (vertices) => {
    const { WallNode } = await import('../index')
    const zone = room('Bedroom', { polygon: square.slice(0, vertices) })
    const scene = graph([[zone]])
    const level = scene.nodes[scene.rootNodeIds[0]!]! as LevelNode
    const walls = square.map((start, i) =>
      WallNode.parse({ parentId: level.id, start, end: square[(i + 1) % square.length] }),
    )
    for (const wall of walls) scene.nodes[wall.id] = wall
    level.children.push(...walls.map((wall) => wall.id))
    const stored = scene.nodes[zone.id] as ZoneNode
    stored.boundaryWallIds = walls.map((wall) => wall.id)
    expect(roomCounts(scene)).toEqual({
      rooms: 1,
      bedrooms: 1,
      modelledAreaM2: 16,
      unclassifiedZones: 0,
    })
    stored.visible = false
    expect(roomCounts(scene).rooms).toBe(0)
  },
)
