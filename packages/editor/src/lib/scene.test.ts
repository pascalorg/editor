import { beforeEach, describe, expect, test } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { syncEditorSelectionFromCurrentScene } from './scene'

const building = {
  children: ['level_scene-root'],
  id: 'building_scene-root',
  object: 'node',
  parentId: null,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  type: 'building',
  visible: true,
}

const level = {
  children: ['wall_scene-root'],
  id: 'level_scene-root',
  level: 0,
  object: 'node',
  parentId: building.id,
  type: 'level',
  visible: true,
}

const wall = {
  children: [],
  end: [4, 0],
  id: 'wall_scene-root',
  object: 'node',
  parentId: level.id,
  start: [0, 0],
  type: 'wall',
  visible: true,
}

describe('scene selection synchronization', () => {
  beforeEach(() => {
    useViewer.getState().resetSelection()
    useEditor.setState({ mode: 'select', phase: 'site', tool: null })
  })

  test('enters the first level when a scene graph is rooted at a building', () => {
    useScene.setState({
      nodes: {
        [building.id]: building,
        [level.id]: level,
        [wall.id]: wall,
      },
      rootNodeIds: [building.id],
    } as never)

    syncEditorSelectionFromCurrentScene()

    expect(useViewer.getState().selection).toMatchObject({
      buildingId: building.id,
      levelId: level.id,
    })
    expect(useEditor.getState().phase).toBe('structure')
  })
})
