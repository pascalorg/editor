import { afterEach, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  DoorNode,
  getWallBodyCenterOffset,
  ItemNode,
  LevelNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { Box3, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { buildDoorPreviewMesh } from '../door/door-system'
import { ItemSystem } from '../item/item-system'
import { buildWindowPreviewMesh } from '../window/window-system'
import { generateExtrudedWall, runWallBuildFrame } from './wall-system'

const original = useScene.getState()
afterEach(() => {
  useScene.setState(original)
  useLiveNodeOverrides.getState().clearAll()
})
for (const justification of ['a', 'b'] as const)
  for (const rotation of [0, Math.PI]) {
    test(`opening mesh and proxy share body centre: ${justification}, yaw ${rotation}`, () => {
      const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.4, justification })
      useScene.setState({ nodes: { [wall.id]: wall } })
      const props = { parentId: wall.id, position: [2, 1, 0], rotation: [0, rotation, 0] }
      const meshes = [
        buildDoorPreviewMesh(DoorNode.parse(props)),
        buildWindowPreviewMesh(WindowNode.parse(props)),
      ]
      for (const mesh of meshes) {
        mesh.updateMatrixWorld(true)
        expect(mesh.position.z).toBe(getWallBodyCenterOffset(wall))
        const proxy = mesh.getObjectByName('cutout')!
        const bounds = new Box3().setFromObject(proxy)
        expect(bounds.getCenter(new Vector3()).z).toBeCloseTo(getWallBodyCenterOffset(wall), 6)
        expect(bounds.min.z).toBeLessThan(justification === 'a' ? 0 : -0.4)
        expect(bounds.max.z).toBeGreaterThan(justification === 'a' ? 0.4 : 0)
        mesh.traverse((child) => {
          if (child instanceof Mesh) child.geometry.dispose()
        })
      }
    })
  }

test('justified door cuts through both wall faces at body-centred local z', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.4, justification: 'a' })
  const door = DoorNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const registered = new Mesh()
  sceneRegistry.nodes.set(wall.id, registered)
  const geometry = generateExtrudedWall(wall, [door], calculateLevelMiters([wall]))
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  for (const z of [-1, 1]) {
    const ray = new Raycaster(new Vector3(2, 1, z), new Vector3(0, 0, -Math.sign(z)))
    expect(ray.intersectObject(mesh)).toHaveLength(0)
    ray.ray.origin.x = 0.5
    expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  }
  geometry.dispose()
  material.dispose()
  registered.geometry.dispose()
  sceneRegistry.nodes.delete(wall.id)
})

test('opening previews follow an uncommitted host justification override', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.4 })
  useScene.setState({ nodes: { [wall.id]: wall } })
  useLiveNodeOverrides.getState().set(wall.id, { justification: 'a' })
  const mesh = buildDoorPreviewMesh(DoorNode.parse({ parentId: wall.id }))
  expect(mesh.position.z).toBe(0.2)
  mesh.traverse((child) => {
    if (child instanceof Mesh) child.geometry.dispose()
  })
})

test('hosted item system places embedded meshes at body centre and mounted meshes at faces', async () => {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.4, justification: 'a' })
  for (const attachTo of ['wall', 'wall-side'] as const) {
    const item = ItemNode.parse({
      parentId: wall.id,
      position: [2, 1, 0],
      side: 'front',
      asset: {
        id: 'test',
        name: 'test',
        category: 'test',
        thumbnail: '',
        src: '/test.glb',
        attachTo,
      },
    })
    const mesh = new Mesh()
    sceneRegistry.nodes.set(item.id, mesh)
    useScene.setState({
      nodes: { [wall.id]: wall, [item.id]: item },
      dirtyNodes: new Set([item.id]),
    })
    const renderer = await create(createElement(ItemSystem))
    try {
      await act(async () => {
        await renderer.advanceFrames(1, 0.016)
      })
      expect(mesh.position.z).toBe(attachTo === 'wall' ? 0.2 : 0.4)
    } finally {
      await renderer.unmount()
      mesh.geometry.dispose()
      sceneRegistry.nodes.delete(item.id)
    }
  }
})

test('changing a built host frame invalidates its children once without a rebuild loop', () => {
  const level = LevelNode.parse({})
  const door = DoorNode.parse({ position: [2, 1, 0] })
  const wall = WallNode.parse({
    parentId: level.id,
    children: [door.id],
    start: [0, 0],
    end: [4, 0],
    thickness: 0.4,
  })
  const mesh = new Mesh()
  sceneRegistry.nodes.set(wall.id, mesh)
  const nodes = {
    [level.id]: { ...level, children: [wall.id] },
    [wall.id]: wall,
    [door.id]: { ...door, parentId: wall.id },
  }
  useScene.setState({ nodes, dirtyNodes: new Set([wall.id]) })
  try {
    runWallBuildFrame()
    expect(mesh.userData.wallFrameKey).toBe('0.2:-0.2')
    useScene.setState({
      nodes: { ...nodes, [wall.id]: { ...wall, justification: 'a' } },
      dirtyNodes: new Set([wall.id]),
    })
    runWallBuildFrame()
    expect(useScene.getState().dirtyNodes.has(door.id)).toBe(true)
    useScene.setState({ dirtyNodes: new Set([wall.id]) })
    runWallBuildFrame()
    expect(useScene.getState().dirtyNodes.has(door.id)).toBe(false)
  } finally {
    mesh.geometry.dispose()
    sceneRegistry.nodes.delete(wall.id)
  }
})
