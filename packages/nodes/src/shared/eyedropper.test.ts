import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  type AnyNode,
  CeilingNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  roomFinishRole,
  SlabNode,
  useScene,
  WallNode,
  wallRegionRole,
  wallRoomFaceRole,
  ZoneNode,
} from '@pascal-app/core'
import { eyedropperMaterial } from '@pascal-app/editor'
import { Mesh, MeshStandardMaterial } from 'three'
import { ceilingDefinition } from '../ceiling/definition'
import { slabDefinition } from '../slab/definition'
import { wallDefinition } from '../wall/definition'

// The eyedropper reads a surface the way paint does: the finish a region, room
// or override gives it, what an unpainted derived role draws with, else the
// slot's declared default — the renderer's own chain.

const square = (x: number, z: number, size: number): [number, number][] => [
  [x, z],
  [x + size, z],
  [x + size, z + size],
  [x, z + size],
]
const saved = useScene.getState()

const level = LevelNode.parse({ id: 'level_pick' })
const zone = ZoneNode.parse({
  id: 'zone_pick',
  name: 'Kitchen',
  parentId: level.id,
  spaceRole: 'room',
  polygon: square(0, 0, 4),
  wallMaterial: 'library:brick',
  wallOverrides: [{ wallId: 'wall_pick', face: 'a', finish: 'library:paint-green' }],
  floor: { regions: [{ id: 'rug', polygon: square(1, 1, 1), finish: 'library:tile' }] },
  ceiling: { regions: [{ id: 'patch', polygon: square(0, 0, 2), finish: 'library:blue' }] },
})
const wall = WallNode.parse({
  id: 'wall_pick',
  parentId: level.id,
  start: [0, 0],
  end: [4, 0],
  faceRegions: [{ id: 'stripe', face: 'b', finish: 'library:red' }],
})
const plate = SlabNode.parse({
  id: 'slab_pick',
  parentId: level.id,
  boundary: 'auto',
  autoFromWalls: true,
  plateRole: 'base',
  zoneIds: [zone.id],
  polygon: square(0, 0, 4),
})
const ceiling = CeilingNode.parse({
  id: 'ceiling_pick',
  parentId: level.id,
  polygon: square(0, 0, 4),
  boundary: 'auto',
  zoneId: zone.id,
})
const nodes = Object.fromEntries(
  [level, zone, wall, plate, ceiling].map((node) => [node.id, node]),
) as Record<string, AnyNode>

beforeAll(() => {
  for (const definition of [wallDefinition, slabDefinition, ceilingDefinition]) {
    if (!nodeRegistry.get(definition.kind)) registerNode(definition as never)
  }
  useScene.setState({ nodes, materials: {}, readOnly: false } as never)
})
afterAll(() => useScene.setState(saved))

const pick = (node: AnyNode, role: string, hitObject?: Mesh) =>
  eyedropperMaterial({ node, role, nodes: useScene.getState().nodes, hitObject })
const preset = (node: AnyNode, role: string) => pick(node, role)?.materialPreset

test('walls: a face region, a room override, the room finish, then the face default', () => {
  expect(preset(wall, wallRegionRole('stripe'))).toBe('library:red')
  expect(preset(wall, wallRoomFaceRole(zone.id, 'a'))).toBe('library:paint-green')
  const { wallOverrides: _, ...plain } = zone
  useScene.setState({ nodes: { ...nodes, [zone.id]: plain as AnyNode } })
  expect(preset(wall, wallRoomFaceRole(zone.id, 'a'))).toBe('library:brick')
  useScene.setState({ nodes })
  expect(preset(wall, 'b')).toBe('library:concrete-drywall')
})

test('floors: a region, the room floor, and an unpainted room shows the plate top', () => {
  expect(preset(plate, roomFinishRole(zone.id, 'rug'))).toBe('library:tile')
  expect(preset(plate, roomFinishRole(zone.id))).toBe('library:wood-woodplank48')
  useScene.setState({
    nodes: { ...nodes, [zone.id]: { ...zone, floor: { ...zone.floor, finish: 'library:oak' } } },
  })
  expect(preset(plate, roomFinishRole(zone.id))).toBe('library:oak')
  useScene.setState({ nodes })
  expect(preset(plate, 'foundation')).toBe('library:concrete-raw')
})

test('ceilings: a painted part, a painted ceiling, and the flat default colour', () => {
  expect(preset(ceiling, 'region:patch')).toBe('library:blue')
  const unpainted = pick(ceiling, 'surface')
  expect(unpainted?.material?.properties?.color).toBe('#f2eee6')
  expect(unpainted?.sourceTarget).toBe('ceiling')
  const painted = { ...ceiling, slots: { surface: 'library:plaster' } }
  useScene.setState({ nodes: { ...nodes, [ceiling.id]: painted } })
  expect(preset(painted, 'surface')).toBe('library:plaster')
  useScene.setState({ nodes })
})

test('a slot with no finish anywhere reads the drawn material off the hit mesh', () => {
  const unknown = { ...wall, id: 'wall_unregistered', type: 'not-a-kind' } as unknown as AnyNode
  const mesh = new Mesh(undefined, new MeshStandardMaterial({ color: '#336699', roughness: 0.2 }))
  const drawn = pick(unknown, 'body', mesh)
  expect(drawn?.material?.properties).toMatchObject({ color: '#336699', roughness: 0.2 })
  expect(pick(unknown, 'body')).toBeNull()
})
