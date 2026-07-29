import { afterEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  initSpaceDetectionSync,
  LevelNode,
  SiteNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import useEditor from '../store/use-editor'
import { applySceneGraphToEditor } from './scene'

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)) as unknown as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame
}

function loadedRoomWithoutSurfaces() {
  const walls = [
    WallNode.parse({ id: 'wall_1', start: [0, 0], end: [4, 0], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_2', start: [4, 0], end: [4, 3], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_3', start: [4, 3], end: [0, 3], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_4', start: [0, 3], end: [0, 0], parentId: 'level_0' }),
  ]
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: 'building_0',
    children: walls.map((wall) => wall.id),
  })
  const building = BuildingNode.parse({
    id: 'building_0',
    parentId: 'site_0',
    children: [level.id],
  })
  const site = SiteNode.parse({ id: 'site_0', children: [building.id] })
  const nodes = [site, building, level, ...walls]

  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: [site.id],
  }
}

describe('applySceneGraphToEditor', () => {
  afterEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      installedPlugins: [],
      hasExplicitPluginInstallState: false,
    })
    useScene.temporal.getState().clear()
  })

  test('loading a closed room does not recreate a slab or ceiling deleted before reload', () => {
    const unsubscribe = initSpaceDetectionSync(useScene, useEditor)

    try {
      applySceneGraphToEditor(loadedRoomWithoutSurfaces())

      const surfaces = Object.values(useScene.getState().nodes).filter(
        (node) => node.type === 'slab' || node.type === 'ceiling',
      )
      expect(surfaces).toHaveLength(0)
    } finally {
      unsubscribe()
    }
  })
})
