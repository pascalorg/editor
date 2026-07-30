import { afterEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  type CameraControlFitSceneEvent,
  emitter,
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
    const unsubscribe = initSpaceDetectionSync(useScene, {
      onSpacesChanged: (spaces) => useEditor.getState().setSpaces(spaces),
    })

    try {
      applySceneGraphToEditor(loadedRoomWithoutSurfaces())

      const surfaces = Object.values(useScene.getState().nodes).filter(
        (node) => node.type === 'slab' || node.type === 'ceiling',
      )
      expect(surfaces).toHaveLength(0)
      expect(Object.values(useEditor.getState().spaces)).toHaveLength(1)
    } finally {
      unsubscribe()
    }
  })

  test('initial load requests a camera fit for the refreshed 3D viewport', () => {
    let fitBounds: CameraControlFitSceneEvent['bounds']
    const handleFitScene = (event: CameraControlFitSceneEvent) => {
      fitBounds = event.bounds
    }

    emitter.on('camera-controls:fit-scene', handleFitScene)
    try {
      applySceneGraphToEditor(loadedRoomWithoutSurfaces(), { fitCamera: true })
      expect(fitBounds).toEqual({
        min: [0, 0],
        max: [4, 3],
        center: [2, 1.5],
        size: [4, 3],
      })
    } finally {
      emitter.off('camera-controls:fit-scene', handleFitScene)
    }
  })

  test('ordinary scene application does not reframe an active camera', () => {
    let fitEventCount = 0
    const handleFitScene = () => {
      fitEventCount += 1
    }

    emitter.on('camera-controls:fit-scene', handleFitScene)
    try {
      applySceneGraphToEditor(loadedRoomWithoutSurfaces())
      expect(fitEventCount).toBe(0)
    } finally {
      emitter.off('camera-controls:fit-scene', handleFitScene)
    }
  })
})
