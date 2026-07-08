import { afterEach, describe, expect, test } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { BuildingNode, LevelNode, SiteNode } from '@pascal-app/core/schema'
import { serializeMeasurements, useMeasurementTool } from '../store/use-measurement-tool'
import {
  applySceneGraphToEditor,
  loadSceneFromLocalStorage,
  type SceneGraph,
  saveSceneToLocalStorage,
} from './scene'

const storage = new Map<string, string>()

globalThis.localStorage = {
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size
  },
  removeItem: (key: string) => {
    storage.delete(key)
  },
  setItem: (key: string, value: string) => {
    storage.set(key, value)
  },
} as Storage

function makeSceneGraph(): SceneGraph {
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  const level = LevelNode.parse({ level: 0, parentId: building.id })

  return {
    nodes: {
      [site.id]: { ...site, children: [building.id] },
      [building.id]: { ...building, children: [level.id] },
      [level.id]: level,
    },
    rootNodeIds: [site.id],
  }
}

afterEach(() => {
  useScene.getState().clearScene()
  useMeasurementTool.getState().clear()
  storage.clear()
})

describe('scene measurement persistence', () => {
  test('saves and loads measurements with the scene graph payload', () => {
    useMeasurementTool.getState().addSegment('2d', [0, 0, 0], [4, 0, 0])
    useMeasurementTool.getState().addArea('3d', [1, 0, 1], 24)
    const sceneGraph = {
      ...makeSceneGraph(),
      measurements: serializeMeasurements(),
    }

    saveSceneToLocalStorage(sceneGraph)
    const loaded = loadSceneFromLocalStorage()

    expect(loaded?.measurements).toEqual(sceneGraph.measurements)
  })

  test('hydrates measurements when applying a scene and clears them for empty scenes', () => {
    useMeasurementTool.getState().addSegment('2d', [0, 0, 0], [4, 0, 0])
    const sceneGraph = {
      ...makeSceneGraph(),
      measurements: serializeMeasurements(),
    }
    useMeasurementTool.getState().clear()

    applySceneGraphToEditor(sceneGraph)
    expect(useMeasurementTool.getState().segments).toEqual(sceneGraph.measurements.segments)

    applySceneGraphToEditor(null)
    expect(serializeMeasurements()).toEqual({
      version: 1,
      segments: [],
      areas: [],
      perimeters: [],
      angles: [],
    })
  })
})
