import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  clearSceneHistory,
  LevelNode,
  roomFinishRole,
  SlabNode,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { Group, Mesh, MeshBasicMaterial } from 'three'
import { slabPaint } from '../paint'

// Paint mode's Erase is the paint path with no material: a painted region on a
// room floor goes, and a floor painted as a whole returns to its default.

const saved = useScene.getState()
afterEach(() => useScene.setState(saved))

test('erase removes the floor region under the click, then resets the whole floor', () => {
  const level = LevelNode.parse({ id: 'level_erase' })
  const zone = ZoneNode.parse({
    id: 'zone_erase',
    name: 'Kitchen',
    parentId: level.id,
    spaceRole: 'room',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    floor: {
      finish: 'library:oak',
      regions: [
        {
          id: 'rug',
          polygon: [
            [1, 1],
            [2, 1],
            [2, 2],
          ],
          finish: 'library:tile',
        },
      ],
    },
  })
  const plate = SlabNode.parse({
    id: 'slab_erase',
    parentId: level.id,
    plateRole: 'base',
    polygon: zone.polygon,
  })
  const nodes = { [level.id]: level, [zone.id]: zone, [plate.id]: plate } as Record<string, AnyNode>
  useScene.setState({ nodes, materials: {}, readOnly: false } as never)
  const erase = (role: string) =>
    slabPaint.commit({
      node: useScene.getState().nodes[plate.id]!,
      role,
      material: undefined,
      materialPreset: undefined,
    })
  const floor = () => (useScene.getState().nodes[zone.id] as ZoneNode).floor

  erase(roomFinishRole(zone.id, 'rug'))
  expect(floor()?.regions).toEqual([])
  expect(floor()?.finish).toBe('library:oak')

  erase(roomFinishRole(zone.id))
  expect(floor()?.finish).toBeUndefined()
})

test('erasing a room floor in the room scope clears its finish, parts, steps and edge — and previews it', () => {
  const level = LevelNode.parse({ id: 'level_room_erase' })
  const square = (x: number): [number, number][] => [
    [x, 0],
    [x + 4, 0],
    [x + 4, 3],
    [x, 3],
  ]
  const zone = ZoneNode.parse({
    id: 'zone_room_erase',
    name: 'Kitchen',
    parentId: level.id,
    spaceRole: 'room',
    polygon: square(0),
    floorStepFinish: 'library:step',
    floorEdgeFinish: 'library:edge',
    floor: {
      finish: 'library:oak',
      regions: [{ id: 'rug', polygon: square(1).slice(0, 3), finish: 'library:tile' }],
    },
  })
  const neighbour = ZoneNode.parse({
    ...zone,
    id: 'zone_room_keep',
    polygon: square(4),
  })
  const plate = SlabNode.parse({
    id: 'slab_room_erase',
    parentId: level.id,
    plateRole: 'base',
    boundary: 'auto',
    polygon: square(0),
    zoneIds: [zone.id, neighbour.id],
  })
  const nodes = {
    [level.id]: level,
    [zone.id]: zone,
    [neighbour.id]: neighbour,
    [plate.id]: plate,
  } as Record<string, AnyNode>
  useScene.setState({ nodes, materials: {}, readOnly: false } as never)
  clearSceneHistory()
  const role = `room:${zone.id}/*`

  // The preview swaps exactly the surfaces the click changes.
  const root = new Group()
  const meshes = Object.fromEntries(
    [
      roomFinishRole(zone.id),
      roomFinishRole(zone.id, 'rug'),
      `step:${zone.id}`,
      `edge:${zone.id}`,
      roomFinishRole(neighbour.id),
    ].map((paintRole) => {
      const mesh = new Mesh(undefined, new MeshBasicMaterial())
      mesh.userData = { paintRole, __fromGeometry: true }
      root.add(mesh)
      return [paintRole, mesh]
    }),
  )
  const drawn = () => Object.values(meshes).map((mesh) => mesh.material)
  const before = drawn()
  const restore = slabPaint.applyPreview({
    node: plate,
    role,
    material: undefined,
    materialPreset: undefined,
    root,
  })
  const changed = drawn().map((material, index) => material !== before[index])
  expect(changed).toEqual([true, true, true, true, false])
  restore?.()
  expect(drawn()).toEqual(before)

  const paint = slabPaint.applyPreview({
    node: plate,
    role,
    material: undefined,
    materialPreset: 'library:preset-tomato',
    root,
  })
  // Painting the room gives its floor and its painted parts one finish; its
  // steps carry their own finish.
  expect(drawn().map((material, index) => material !== before[index])).toEqual([
    true,
    true,
    false,
    false,
    false,
  ])
  paint?.()

  slabPaint.commit({ node: plate, role, material: undefined, materialPreset: undefined })
  const after = useScene.getState().nodes[zone.id] as ZoneNode
  expect(after.floor?.finish).toBeUndefined()
  expect(after.floor?.regions).toBeUndefined()
  expect(after.floorStepFinish).toBeUndefined()
  expect(after.floorEdgeFinish).toBeUndefined()
  expect(useScene.getState().nodes[neighbour.id]).toEqual(neighbour)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})
