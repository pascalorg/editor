import { afterEach, expect, test } from 'bun:test'
import { LevelNode, sceneRegistry, useScene, WallNode, WindowNode } from '@pascal-app/core'
import { runWallBuildFrame } from '@pascal-app/viewer'
import { Mesh } from 'three'
import { curtainWallGeometryAdapter } from './curtain-wall-adapter'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => undefined

const initial = useScene.getState()

afterEach(() => {
  sceneRegistry.clear()
  useScene.setState(initial)
})

test('switching a curtain window top shape stays within one frame', () => {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [30, 0],
    wallType: 'curtain',
    curtainWall: {
      columns: { layout: 'count', count: 32 },
      rows: { layout: 'count', count: 32 },
    },
  })
  const window = WindowNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [15, 1.5, 0],
    width: 1.2,
    height: 1.2,
    openingShape: 'rectangle',
  })
  wall.children = [window.id]
  level.children = [wall.id]
  useScene.setState({
    nodes: { [level.id]: level, [wall.id]: wall, [window.id]: window },
    dirtyNodes: new Set([wall.id]),
  })
  const mesh = new Mesh()
  sceneRegistry.nodes.set(wall.id, mesh)
  sceneRegistry.byType.wall!.add(wall.id)
  runWallBuildFrame(curtainWallGeometryAdapter)

  const measurements: number[] = []
  for (const openingShape of ['rounded', 'rectangle', 'arch', 'rectangle'] as const) {
    useScene.getState().updateNode(window.id, { openingShape })
    useScene.getState().markDirty(wall.id)
    const started = performance.now()
    runWallBuildFrame(curtainWallGeometryAdapter)
    measurements.push(performance.now() - started)
  }

  expect(Math.max(...measurements)).toBeLessThan(25)
  mesh.geometry.dispose()
})
