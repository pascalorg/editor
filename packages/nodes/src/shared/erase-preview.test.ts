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
  ZoneNode,
} from '@pascal-app/core'
import { Mesh, MeshBasicMaterial } from 'three'
import { ceilingDefinition } from '../ceiling/definition'
import { ceilingPaint } from '../ceiling/paint'
import { slabDefinition } from '../slab/definition'
import { erasedSlabLook } from '../slab/paint'
import { wallDefinition } from '../wall/definition'

// The eraser's hover shows the surface as it will look once erased — what
// lies under a region, the room's finish under an override, a slot's default —
// never the paint colour in hand (the eraser has none).

const square = (x: number, z: number, size: number): [number, number][] => [
  [x, z],
  [x + size, z],
  [x + size, z + size],
  [x, z + size],
]
const saved = useScene.getState()
const level = LevelNode.parse({ id: 'level_erase_look' })
const zone = ZoneNode.parse({
  id: 'zone_erase_look',
  name: 'Kitchen',
  parentId: level.id,
  spaceRole: 'room',
  polygon: square(0, 0, 4),
  boundaryWallIds: ['wall_erase_look'],
  wallMaterial: 'library:brick',
  wallOverrides: [{ wallId: 'wall_erase_look', face: 'a', finish: 'library:paint-green' }],
  floor: {
    finish: 'library:oak',
    regions: [{ id: 'rug', polygon: square(1, 1, 1), finish: 'library:tile' }],
  },
})
const wall = WallNode.parse({
  id: 'wall_erase_look',
  parentId: level.id,
  start: [0, 0],
  end: [4, 0],
  height: 2.5,
  slots: { b: 'library:paint-blue' },
  faceRegions: [{ id: 'stripe', face: 'b', u0: 1, u1: 2, finish: 'library:red' }],
})
const plate = SlabNode.parse({
  id: 'slab_erase_look',
  parentId: level.id,
  boundary: 'auto',
  autoFromWalls: true,
  plateRole: 'base',
  zoneIds: [zone.id],
  polygon: square(0, 0, 4),
})
const ceiling = CeilingNode.parse({
  id: 'ceiling_erase_look',
  parentId: level.id,
  polygon: square(0, 0, 4),
  slots: { surface: 'library:plaster' },
})
const nodes = Object.fromEntries(
  [level, zone, wall, plate, ceiling].map((node) => [node.id, node]),
) as Record<string, AnyNode>

beforeAll(() => {
  for (const definition of [wallDefinition, slabDefinition, ceilingDefinition])
    if (!nodeRegistry.get(definition.kind)) registerNode(definition as never)
  useScene.setState({ nodes, materials: {}, readOnly: false } as never)
})
afterAll(() => useScene.setState(saved))

const args = (node: AnyNode, role: string) => ({
  node,
  role,
  material: undefined,
  materialPreset: undefined,
  root: new Mesh(),
})

test('floors: a region shows the room floor, the room floor the plate top, steps the floor', () => {
  expect(erasedSlabLook(args(plate, roomFinishRole(zone.id, 'rug')))).toEqual({
    materialPreset: 'library:oak',
  })
  expect(erasedSlabLook(args(plate, roomFinishRole(zone.id)))?.materialPreset).toBe(
    'library:wood-woodplank48',
  )
  expect(erasedSlabLook(args(plate, `step:${zone.id}`))).toEqual({ materialPreset: 'library:oak' })
  expect(erasedSlabLook(args(plate, 'foundation'))).toEqual({
    materialPreset: 'library:concrete-raw',
  })
})

test('a ceiling hover while erasing shows its default, never a paint colour', () => {
  const tinted = new MeshBasicMaterial()
  const root = new Mesh(undefined, tinted)
  const restore = ceilingPaint.applyPreview({ ...args(ceiling, 'surface'), root })
  const shown = root.material as MeshBasicMaterial
  expect(shown).not.toBe(tinted)
  expect(`#${shown.color.getHexString()}`).toBe('#f2eee6')
  restore?.()
  expect(root.material).toBe(tinted)
})
