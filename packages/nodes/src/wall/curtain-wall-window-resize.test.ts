import { afterEach, expect, test } from 'bun:test'
import {
  LevelNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  WindowNode,
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

test('curtain window width previews rebuild a clear opening and cancel without document writes', () => {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [6, 0],
    wallType: 'curtain',
  })
  const window = WindowNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [1.5, 1.5, 0],
    width: 0.9,
    height: 1,
  })
  wall.children = [window.id]
  level.children = [wall.id]
  useScene.setState({
    nodes: { [level.id]: level, [wall.id]: wall, [window.id]: window },
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
    expect(hit(0.85, 1.4).length).toBeGreaterThan(0)
    useLiveNodeOverrides.getState().set(window.id, { width: 1.6 })
    useScene.getState().markDirty(wall.id)
    runWallBuildFrame(curtainWallGeometryAdapter)
    expect(hit(0.85, 1.4)).toHaveLength(0)
    expect(hit(0.675, 1.4)[0]?.face?.materialIndex).toBe(0)
    expect(hit(1.5, 0.975)[0]?.face?.materialIndex).toBe(0)
    expect(hit(1.5, 2.025)[0]?.face?.materialIndex).toBe(0)
    expect(hit(0.85, 2.4)[0]?.face?.materialIndex).toBe(1)
    expect(useScene.getState().nodes[window.id]).toBe(window)
    for (const openingShape of ['rounded', 'arch', 'rectangle'] as const) {
      useLiveNodeOverrides
        .getState()
        .set(window.id, { openingShape, cornerRadius: 0.25, archHeight: 0.4 })
      useScene.getState().markDirty(wall.id)
      runWallBuildFrame(curtainWallGeometryAdapter)
      expect(hit(1.5, 1.5)).toHaveLength(0)
      expect(hit(1.5, 2.025)[0]?.face?.materialIndex).toBe(0)
      expect(useScene.getState().nodes[window.id]).toBe(window)
    }
    useLiveNodeOverrides.getState().clear(window.id)
    useScene.getState().markDirty(wall.id)
    runWallBuildFrame(curtainWallGeometryAdapter)
    expect(hit(0.85, 1.4).length).toBeGreaterThan(0)
    expect(useScene.getState().nodes[window.id]).toBe(window)
  } finally {
    mesh.geometry.dispose()
    material.dispose()
  }
})
