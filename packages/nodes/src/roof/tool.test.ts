import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  type RoofNode,
  resolveRoomRoofFootprint,
  type SceneApi,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { commitRoofFootprint, commitRoofPlacement } from './tool'

const originalDefaults = useEditor.getState().toolDefaults

afterEach(() => useEditor.setState({ toolDefaults: originalDefaults }))

function setup() {
  const level = LevelNode.parse({ level: 0, height: 3 })
  const upper = LevelNode.parse({ level: 1, height: 3 })
  const polygon: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      parentId: level.id,
      start,
      end: polygon[(index + 1) % polygon.length],
      height: 2.5,
    }),
  )
  level.children = walls.map((wall) => wall.id)
  const nodes = Object.fromEntries([level, upper, ...walls].map((node) => [node.id, node]))
  const created: Array<{ node: AnyNode; parentId?: AnyNodeId }> = []
  const updated: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  const sceneApi = {
    nodes: () => nodes,
    createMany: (ops) => created.push(...ops),
    update: (id, data) => updated.push({ id, data }),
  } as SceneApi
  return { level, upper, nodes, created, updated, sceneApi }
}

test('room creation follows walls and retains the computed initial Y', () => {
  const { upper, nodes, created, sceneApi } = setup()
  useEditor.getState().setToolDefaults('roof', { roofType: 'gable', support: { kind: 'level' } })
  const target = resolveRoomRoofFootprint(upper.id, nodes, [2, 1])!
  commitRoofFootprint(sceneApi, upper.id, target, false)
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(upper.id)
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
})

test('free-drawn rectangles stay custom at Y zero even with following preset defaults', () => {
  const { upper, created, sceneApi } = setup()
  useEditor.getState().setToolDefaults('roof', { roofType: 'gable', support: { kind: 'walls' } })
  commitRoofPlacement(sceneApi, upper.id, [0, 9, 0], [4, 9, 3], [], false, 'ground')
  const roof = created.find(({ node }) => node.type === 'roof')?.node as RoofNode
  expect(roof).toMatchObject({ support: { kind: 'level' }, position: [2, 0, 1.5] })
})

test("room creation from the walls' own level still parents the roof to the level above", () => {
  const { upper, nodes, created, sceneApi } = setup()
  const level = Object.values(nodes).find((node) => node.type === 'level' && node.id !== upper.id)!
  const target = resolveRoomRoofFootprint(level.id as LevelNode['id'], nodes, [2, 1])!
  commitRoofFootprint(sceneApi, level.id as LevelNode['id'], target, false)
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(upper.id)
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
})

test('room creation on the top floor puts the roof on a new Roof level, on the wall tops', () => {
  const { upper, nodes, created, sceneApi } = setup()
  delete nodes[upper.id]
  const level = Object.values(nodes).find((node) => node.type === 'level')!
  const target = resolveRoomRoofFootprint(level.id as LevelNode['id'], nodes, [2, 1])!
  commitRoofFootprint(sceneApi, level.id as LevelNode['id'], target, false)
  const roofLevel = created.find(({ node }) => node.type === 'level')?.node as LevelNode
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roofLevel).toMatchObject({ name: 'Roof', level: 1, metadata: { role: 'roof' } })
  expect(roof.parentId).toBe(roofLevel.id)
  // 2.5 m walls under a 3 m storey: the eave 0.5 m below the roof level's floor.
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
})

// Lifted onto the roof level, a drawn rectangle stayed on that level's plane: walls taller or
// lower than their storey left it floating or buried, and it never followed their height.
test('a rectangle drawn on a walled storey goes on its roof level, standing on its walls', () => {
  const { level, upper, created, updated, sceneApi } = setup()
  commitRoofPlacement(sceneApi, level.id, [0, 0, 0], [4, 0, 3], [], false, 'ground')
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(upper.id)
  // 2.5 m walls under a 3 m storey: the eave 0.5 m below the roof level's floor.
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
  expect(updated).toEqual([{ id: upper.id, data: { metadata: { role: 'roof' }, name: 'Roof' } }])
})

// The owner's porch clause: a porch or portico on posts stays on its storey. Drawn by hand, any
// rectangle on a walled storey went to the roof level, a portico beside the house included.
test('a porch drawn against the house over posts stays on its storey', () => {
  const { level, nodes, created, updated, sceneApi } = setup()
  const room = ZoneNode.parse({
    parentId: level.id,
    name: 'Room',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  })
  nodes[room.id] = room
  nodes[level.id] = { ...level, children: [...level.children, room.id] }
  commitRoofPlacement(sceneApi, level.id, [4, 0, 0.5], [6, 0, 2.5], [], false, 'ground')
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(level.id)
  expect(roof.node).toMatchObject({ support: { kind: 'level' } })
  expect(updated).toEqual([])
})

test('drawing ghosts follow every selected roof form instead of a gable fallback', async () => {
  const { RoofSegmentNode, getActiveRoofHeight, RoofType } = await import('@pascal-app/core')
  const { buildRoofGhostGeometry } = await import('./tool')
  const { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } = await import('three')
  const material = new MeshBasicMaterial({ side: DoubleSide })
  try {
    for (const type of RoofType.options) {
      const node = RoofSegmentNode.parse({
        roofType: type,
        width: 8,
        depth: 6,
        wallHeight: 0.5,
        pitch: 40,
      })
      const geometry = buildRoofGhostGeometry(8, 6, 0.5, 40, type)
      try {
        geometry.computeBoundingBox()
        expect(geometry.boundingBox!.max.y).toBeCloseTo(0.5 + getActiveRoofHeight(node), 5)
        const mesh = new Mesh(geometry, material)
        mesh.updateMatrixWorld(true)
        const heightAt = (x: number, z: number) => {
          const ray = new Raycaster(new Vector3(x, 20, z), new Vector3(0, -1, 0))
          return ray.intersectObject(mesh)[0]?.point.y
        }
        const crown = heightAt(0, 0)!
        expect(Number.isFinite(crown)).toBe(true)
        if (type === 'flat') expect(heightAt(2, 1)).toBeCloseTo(0.5, 5)
        if (type === 'hip') expect(heightAt(3.9, 0)!).toBeLessThan(crown / 2)
        if (type === 'shed') expect(heightAt(0, -2.5)!).toBeGreaterThan(heightAt(0, 2.5)!)
        if (type === 'barrel') expect(heightAt(0, 1.5)!).toBeGreaterThan(0.5)
        if (type === 'conical') expect(heightAt(3.5, 0)!).toBeLessThan(crown / 2)
      } finally {
        geometry.dispose()
      }
    }
  } finally {
    material.dispose()
  }
})

test('remounting the roof tool retains the menu-selected shape', async () => {
  const { createElement, StrictMode } = await import('react')
  const { create } = await import('@react-three/test-renderer')
  const { RegistryToolProvider } = await import('@pascal-app/editor')
  const { RoofTool } = await import('./tool')
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const animationGlobals = [
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT',
  ] as const
  const previousGlobals = animationGlobals.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  Object.defineProperties(globalThis, {
    requestAnimationFrame: { configurable: true, value: () => 0 },
    cancelAnimationFrame: { configurable: true, value: () => {} },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  const previousScope = (await import('@pascal-app/editor')).useInteractionScope.getState().scope
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
    }),
  })
  const nodes = {}
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    useEditor.getState().setToolDefaults('roof', { roofType: 'hip' })
    renderer = await create(
      createElement(
        StrictMode,
        {},
        createElement(RegistryToolProvider, {
          value: {
            activeLevelId: null,
            sceneApi: { nodes: () => nodes } as SceneApi,
            isCameraDragging: () => false,
            selectNode: () => {},
            unit: 'metric',
          },
          children: createElement(RoofTool),
        }),
      ),
    )
    await renderer.unmount()
    renderer = undefined
    expect(useEditor.getState().toolDefaults.roof?.roofType).toBe('hip')
  } finally {
    await renderer?.unmount()
    ;(await import('@pascal-app/editor')).useInteractionScope.setState({ scope: previousScope })
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
