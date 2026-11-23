// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { BuildingNode, LevelNode, sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, type Vector3 } from 'three'
import { lampFeeds } from '../../lib/daylight/room-scene'
import { daylightRooms } from '../../lib/daylight/rooms'
import useViewer from '../../store/use-viewer'
import { bakedLevelBaseY } from '../../systems/level/level-utils'
import { roomInputsChanged, useDaylightRooms } from './use-daylight-rooms'

const globals = [
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
] as const
let descriptors: (PropertyDescriptor | undefined)[]
beforeEach(() => {
  descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.assign(globalThis, {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
})
afterEach(() => {
  globals.forEach((key, index) => {
    const descriptor = descriptors[index]
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  })
})

type Nodes = Record<string, { type: string; [key: string]: unknown }>

const level = { type: 'level', elevation: 0, children: ['wall_a', 'item_a'] }
const wall = { type: 'wall', start: [0, 0], end: [4, 0] }
const item = { type: 'item', position: [1, 0, 1], parentId: 'level_a' }
const base: Nodes = { level_a: level, wall_a: wall, item_a: item }

describe('daylight room rebuild trigger', () => {
  test('furniture moving, or re-parenting under a level, leaves the rooms alone', () => {
    const moved: Nodes = { ...base, item_a: { ...item, position: [2, 0, 1] } }
    expect(roomInputsChanged(moved, base)).toBe(false)
    const restacked: Nodes = {
      ...base,
      level_a: { ...level, children: ['wall_a'] },
      item_a: { ...item, parentId: 'item_b' },
    }
    expect(roomInputsChanged(restacked, base)).toBe(false)
    const placed: Nodes = { ...base, item_b: { type: 'item', position: [0, 0, 0] } }
    expect(roomInputsChanged(placed, base)).toBe(false)
  })

  test('walls, levels and other structure rebuild them', () => {
    expect(roomInputsChanged({ ...base, wall_a: { ...wall, end: [5, 0] } }, base)).toBe(true)
    expect(roomInputsChanged({ ...base, level_a: { ...level, elevation: 3 } }, base)).toBe(true)
    const { wall_a: _removed, ...withoutWall } = base
    expect(roomInputsChanged(withoutWall, base)).toBe(true)
    expect(roomInputsChanged({ ...base, door_a: { type: 'door' } }, base)).toBe(true)
  })
})

/** Two furnished storeys under a translated, rotated building, with a window on each. */
function roomFixture(path: 'live' | 'baked') {
  const root = new Group()
  const building = new Group()
  building.position.set(6, 1.5, -4)
  building.rotation.y = 0.35
  building.userData = { kind: 'building', pascalId: 'building_rooms' }
  root.add(building)
  const buildingNode = BuildingNode.parse({ id: 'building_rooms', position: [6, 1.5, -4] })
  const nodes: Record<string, unknown> = { [buildingNode.id]: buildingNode }
  const objects = new Map<string, Group | Mesh>()
  const material = new MeshBasicMaterial()
  const levels: Group[] = []
  const lamps: Group[] = []
  const add = (id: string, type: string, object: Group | Mesh, parent: Group, extra = {}) => {
    object.userData = { ...object.userData, kind: type, pascalId: id, ...extra }
    parent.add(object)
    objects.set(id, object)
    nodes[id] ??= { id, type, parentId: parent.userData.pascalId, ...extra }
    return object
  }
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    return mesh
  }
  for (let i = 0; i < 2; i++) {
    const id = `level_rooms_${i}`
    const level = new Group()
    level.position.y = i * 3.3
    if (path === 'baked') bakedLevelBaseY(level)
    nodes[id] = LevelNode.parse({ id, parentId: buildingNode.id, level: i, height: 3.3 })
    add(id, 'level', level, building)
    levels.push(level)
    add(`zone_rooms_${i}`, 'zone', new Group(), level, {
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    add(`ceiling_rooms_${i}`, 'ceiling', box(4.2, 0.2, 4.2, 2, 2.8, 2), level)
    const wall = add(`wall_rooms_${i}`, 'wall', new Group(), level)
    wall.add(
      box(4.2, 2.7, 0.1, 2, 1.35, -0.05),
      box(4.2, 2.7, 0.1, 2, 1.35, 4.05),
      box(0.1, 2.7, 4, 4.05, 1.35, 2),
      box(0.1, 0.9, 4, -0.05, 0.45, 2),
      box(0.1, 0.6, 4, -0.05, 2.4, 2),
      box(0.1, 1.2, 1.5, -0.05, 1.5, 0.75),
      box(0.1, 1.2, 1.5, -0.05, 1.5, 3.25),
    )
    const window = add(`window_rooms_${i}`, 'window', new Group(), level)
    window.position.set(-0.05, 1.5, 2)
    const glass = box(0.02, 1.2, 1, 0, 0, 0)
    glass.userData.slotId = 'glass'
    window.add(glass)
    const lamp = add(`item_rooms_${i}`, 'item', new Group(), level)
    lamp.position.set(2, 2.2, 2)
    lamps.push(lamp)
  }
  if (path === 'live') {
    useScene.setState({ nodes, dirtyNodes: new Set() } as never)
    for (const [id, object] of objects) {
      sceneRegistry.nodes.set(id, object)
      const type = object.userData.kind as string
      sceneRegistry.byType[type]!.add(id)
    }
    // Live useRegistry does not stamp baked identity metadata on any descendant.
    root.traverse((object) => {
      delete object.userData.pascalId
      delete object.userData.kind
    })
  } else useScene.setState({ nodes: {}, dirtyNodes: new Set() })
  const feed = {
    lights: () =>
      lamps.map((object, index) => ({
        key: `lamp_${index}`,
        object,
        color: '#ffe6c4',
        distance: 6,
        getWorldPosition: (out: Vector3) => {
          object.getWorldPosition(out)
          return true
        },
      })),
    intensity: () => 1,
  }
  lampFeeds.add(feed)
  root.updateWorldMatrix(true, true)
  return { root, levels, feed, objects }
}

function Rooms() {
  useDaylightRooms()
  return null
}

async function mountedRooms(
  path: 'live' | 'baked',
  mode: 'stacked' | 'exploded' | 'solo' | 'manual',
) {
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousInteractive = useInteractive.getState()
  const previousObjects = new Map(sceneRegistry.nodes)
  const previousTypes = Object.fromEntries(
    Object.entries(sceneRegistry.byType).map(([kind, ids]) => [kind, new Set(ids)]),
  )
  sceneRegistry.clear()
  useViewer.setState({ levelMode: mode, geometryRevision: 0 })
  useInteractive.setState({ lampDefault: true })
  const fixture = roomFixture(path)
  const positions = fixture.levels.map((level) => level.position.y)
  // The host has placed the levels before the first daylight frame.
  if (mode !== 'stacked') fixture.levels[1]!.position.y += 12
  const presentation = spyOn(daylightRooms, 'setLevelPresentation')
  const originalBuild = daylightRooms.build.bind(daylightRooms)
  const inputs: unknown[] = []
  const outputs: unknown[] = []
  const build = spyOn(daylightRooms, 'build').mockImplementation((input) => {
    inputs.push({
      levels: input.levels,
      zones: input.zones,
      bounds: input.bounds.clone(),
      covers: input.covers.map(({ object }) => new Box3().setFromObject(object)),
      walls: input.walls.map(({ object }) => new Box3().setFromObject(object)),
      openings: input.openings.map(({ object }) => new Box3().setFromObject(object)),
      lamps: input.lamps.map((lamp) => ({ ...lamp, position: lamp.position.clone() })),
    })
    originalBuild(input)
    outputs.push({
      levels: daylightRooms.levels,
      rooms: daylightRooms.rooms,
      portals: daylightRooms.portals,
      openings: daylightRooms.openings,
    })
  })
  const renderer = await create(
    createElement('primitive', { object: fixture.root }, createElement(Rooms)),
  )
  return {
    ...fixture,
    renderer,
    inputs,
    outputs,
    positions,
    presentation,
    async close() {
      await renderer.unmount()
      build.mockRestore()
      presentation.mockRestore()
      lampFeeds.delete(fixture.feed)
      for (const object of fixture.root.children)
        object.traverse((child) => {
          if (child instanceof Mesh) {
            child.geometry.dispose()
            ;(child.material as MeshBasicMaterial).dispose()
          }
        })
      sceneRegistry.clear()
      for (const [id, object] of previousObjects) sceneRegistry.nodes.set(id, object)
      for (const [kind, ids] of Object.entries(previousTypes))
        for (const id of ids) sceneRegistry.byType[kind]!.add(id)
      useScene.setState(previousScene, true)
      useViewer.setState(previousViewer, true)
      useInteractive.setState(previousInteractive, true)
    },
  }
}

for (const path of ['live', 'baked'] as const) {
  test.each(['exploded', 'solo', 'manual'] as const)(
    `${path}: opening %s builds the same rooms, portals and lamps as opening stacked`,
    async (mode) => {
      const stacked = await mountedRooms(path, 'stacked')
      let inputs: unknown[], outputs: unknown[]
      try {
        await stacked.renderer.advanceFrames(3, 0.1)
        expect(stacked.inputs).toHaveLength(0)
        await stacked.renderer.advanceFrames(1, 0.1)
        expect(stacked.inputs).toHaveLength(1)
        expect(daylightRooms.rooms.map((room) => room.enclosed)).toEqual([true, true])
        expect(daylightRooms.portals.filter((portal) => portal.kind === 0)).toHaveLength(2)
        expect(daylightRooms.rooms.map((room) => room.lamps[0]?.itemId)).toEqual([
          'lamp_0',
          'lamp_1',
        ])
        inputs = stacked.inputs
        outputs = stacked.outputs
      } finally {
        await stacked.close()
      }
      const exploded = await mountedRooms(path, mode)
      try {
        await exploded.renderer.advanceFrames(3, 0.1)
        expect(exploded.inputs).toHaveLength(0)
        await exploded.renderer.advanceFrames(1, 0.1)
        expect(exploded.inputs).toHaveLength(1)
        expect(exploded.inputs).toEqual(inputs!)
        expect(exploded.outputs).toEqual(outputs!)
        expect(exploded.levels[1]!.position.y).toBe(exploded.positions[1]! + 12)
        // The map's live floor heights follow the restored presentation in the very same frame.
        expect(exploded.presentation.mock.calls.at(-1)?.[0]).toEqual([0, 12])
        await exploded.renderer.advanceFrames(30, 0.1)
        expect(exploded.inputs).toHaveLength(1)
        // A burst of edits rebuilds once at rest, in the same assembled frame.
        for (let revision = 1; revision <= 3; revision++) {
          useViewer.setState({ geometryRevision: revision })
          if (path === 'baked') exploded.root.add(new Group())
        }
        await exploded.renderer.advanceFrames(10, 0.1)
        expect(exploded.inputs).toHaveLength(2)
        expect(exploded.inputs[1]).toEqual(inputs![0])
        expect(exploded.outputs[1]).toEqual(outputs![0])
        await exploded.renderer.advanceFrames(30, 0.1)
        expect(exploded.inputs).toHaveLength(2)
      } finally {
        await exploded.close()
      }
    },
  )

  test(`${path}: a stacked build keeps its timing and does not rebuild when levels explode or idle`, async () => {
    const scene = await mountedRooms(path, 'stacked')
    try {
      await scene.renderer.advanceFrames(3, 0.1)
      expect(scene.inputs).toHaveLength(0)
      await scene.renderer.advanceFrames(1, 0.1)
      expect(scene.inputs).toHaveLength(1)
      await scene.renderer.advanceFrames(30, 0.1)
      expect(scene.inputs).toHaveLength(1)
      useViewer.setState({ levelMode: 'exploded' })
      for (let i = 0; i < 15; i++) {
        scene.levels[1]!.position.y += 0.4
        await scene.renderer.advanceFrames(1, 0.1)
      }
      await scene.renderer.advanceFrames(30, 0.1)
      expect(scene.inputs).toHaveLength(1)
    } finally {
      await scene.close()
    }
  })
}

for (const path of ['live', 'baked'] as const) {
  test(`${path}: full section cuts keep rooms enclosed, window portals and lamps without rebuilding`, async () => {
    const scene = await mountedRooms(path, 'stacked')
    try {
      await scene.renderer.advanceFrames(10, 0.1)
      const rooms = daylightRooms.rooms
      const openings = daylightRooms.openings
      const portals = daylightRooms.portals
      const buildCount = scene.inputs.length
      useViewer.getState().setSectionShadows('full')
      useViewer.getState().setSectionEnabled(true)
      for (const axis of ['x', 'y', 'z'] as const) {
        useViewer.getState().setSectionAxis(axis)
        useViewer.getState().setSectionPosition(2)
        await scene.renderer.advanceFrames(10, 0.1)
        expect(scene.inputs).toHaveLength(buildCount)
        expect(daylightRooms.rooms).toBe(rooms)
        expect(daylightRooms.openings).toBe(openings)
        expect(daylightRooms.portals).toBe(portals)
        expect(rooms.map((room) => room.enclosed)).toEqual([true, true])
        expect(rooms.map((room) => room.lamps[0]?.itemId)).toEqual(['lamp_0', 'lamp_1'])
      }
    } finally {
      await scene.close()
    }
  })
}

test('exploded mid-load rooms catch up with late walls and openings without stacking', async () => {
  const stacked = await mountedRooms('live', 'stacked')
  let input: unknown, output: unknown
  try {
    await stacked.renderer.advanceFrames(4, 0.1)
    input = stacked.inputs[0]
    output = stacked.outputs[0]
  } finally {
    await stacked.close()
  }
  const scene = await mountedRooms('live', 'exploded')
  const late = [...scene.objects].filter(([id]) =>
    ['wall', 'window'].includes(useScene.getState().nodes[id as never]!.type),
  )
  const children = late.map(([, object]) => [...object.children])
  try {
    for (const [, object] of late) object.clear()
    useScene.setState({ dirtyNodes: new Set(late.map(([id]) => id)) } as never)
    await scene.renderer.advanceFrames(100, 0.1)
    expect(scene.inputs).toHaveLength(0)
    await scene.renderer.advanceFrames(1, 0.1)
    expect(scene.inputs).toHaveLength(1)
    expect((scene.inputs[0] as { walls: unknown[] }).walls).toHaveLength(0)
    expect((scene.inputs[0] as { openings: Box3[] }).openings.every((box) => box.isEmpty())).toBe(
      true,
    )
    // Geometry systems can finish without a document or geometryRevision change.
    late.forEach(([, object], index) => {
      object.add(...children[index]!)
    })
    useScene.setState({ dirtyNodes: new Set(late.slice(0, 2).map(([id]) => id)) } as never)
    await scene.renderer.advanceFrames(100, 0.1)
    expect(scene.inputs).toHaveLength(1)
    await scene.renderer.advanceFrames(1, 0.1)
    expect(scene.inputs).toHaveLength(2)
    expect(scene.inputs[1]).toEqual(input)
    expect(scene.outputs[1]).toEqual(output)
    expect(scene.levels[1]!.position.y).toBe(scene.positions[1]! + 12)
    useScene.setState({ dirtyNodes: new Set() })
    await scene.renderer.advanceFrames(10, 0.1)
    expect(scene.inputs).toHaveLength(3)
    await scene.renderer.advanceFrames(100, 0.1)
    expect(scene.inputs).toHaveLength(3)
  } finally {
    await scene.close()
  }
})

function transforms(root: Group) {
  const result: unknown[] = []
  root.traverse((object) => {
    result.push({
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      matrix: object.matrix.toArray(),
      world: object.matrixWorld.toArray(),
    })
  })
  return result
}

for (const path of ['live', 'baked'] as const) {
  test.each(['exploded', 'solo', 'manual', 'stacked'] as const)(
    `${path}: pending edits wait for moving levels, then rebuild once at rest in %s`,
    async (mode) => {
      const scene = await mountedRooms(path, 'stacked')
      try {
        await scene.renderer.advanceFrames(4, 0.1)
        const input = scene.inputs[0]
        const output = scene.outputs[0]
        useViewer.setState({ levelMode: mode, geometryRevision: 1 })
        if (path === 'baked') scene.root.add(new Group())
        for (let frame = 0; frame < 20; frame++) {
          scene.levels[1]!.position.y += 0.4
          await scene.renderer.advanceFrames(1, 0.1)
          expect(scene.inputs).toHaveLength(1)
        }
        scene.root.updateWorldMatrix(true, true)
        const before = transforms(scene.root)
        await scene.renderer.advanceFrames(1, 0.1)
        expect(scene.inputs).toHaveLength(2)
        expect(scene.inputs[1]).toEqual(input)
        expect(scene.outputs[1]).toEqual(output)
        // Both descendant and ancestor matrices are restored when the frame callback returns.
        expect(transforms(scene.root)).toEqual(before)
        await scene.renderer.advanceFrames(30, 0.1)
        expect(scene.inputs).toHaveLength(2)
      } finally {
        await scene.close()
      }
    },
  )

  test(`${path}: an initial build also waits for animation to rest`, async () => {
    const scene = await mountedRooms(path, 'exploded')
    try {
      for (let frame = 0; frame < 20; frame++) {
        scene.levels[1]!.position.y += 0.4
        await scene.renderer.advanceFrames(1, 0.1)
        expect(scene.inputs).toHaveLength(0)
      }
      await scene.renderer.advanceFrames(1, 0.1)
      expect(scene.inputs).toHaveLength(1)
      await scene.renderer.advanceFrames(30, 0.1)
      expect(scene.inputs).toHaveLength(1)
    } finally {
      await scene.close()
    }
  })
}
