import { afterEach, expect, test } from 'bun:test'
import {
  DoorNode,
  LevelNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { runWallBuildFrame } from '@pascal-app/viewer'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { curtainWallGeometryAdapter } from './curtain-wall-adapter'

const initial = useScene.getState()
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  sceneRegistry.clear()
  useScene.setState(initial)
})

test('curtain door width previews rebuild a clear opening and cancel without document writes', () => {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [6, 0],
    wallType: 'curtain',
  })
  const door = DoorNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [1.5, 1.05, 0],
    width: 0.9,
  })
  wall.children = [door.id]
  level.children = [wall.id]
  useScene.setState({
    nodes: { [level.id]: level, [wall.id]: wall, [door.id]: door },
    dirtyNodes: new Set([wall.id]),
  })
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(undefined, [material, material, material])
  sceneRegistry.nodes.set(wall.id, mesh)
  sceneRegistry.byType.wall!.add(wall.id)
  const hit = (x: number, y: number) =>
    new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1)).intersectObject(mesh, false)
  try {
    runWallBuildFrame(curtainWallGeometryAdapter)
    expect(hit(0.85, 1).length).toBeGreaterThan(0)
    useLiveNodeOverrides.getState().set(door.id, { width: 1.6 })
    useScene.getState().markDirty(wall.id)
    runWallBuildFrame(curtainWallGeometryAdapter)
    expect(hit(0.85, 1)).toHaveLength(0)
    expect(hit(0.675, 1)[0]?.face?.materialIndex).toBe(0)
    expect(hit(0.85, 2.4)[0]?.face?.materialIndex).toBe(1)
    expect(useScene.getState().nodes[door.id]).toBe(door)
    useLiveNodeOverrides.getState().clear(door.id)
    useScene.getState().markDirty(wall.id)
    runWallBuildFrame(curtainWallGeometryAdapter)
    expect(hit(0.85, 1).length).toBeGreaterThan(0)
    expect(useScene.getState().nodes[door.id]).toBe(door)
  } finally {
    mesh.geometry.dispose()
    material.dispose()
  }
})
