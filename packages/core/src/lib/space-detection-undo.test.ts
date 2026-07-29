import { afterEach, describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { initSpaceDetectionSync, type Space } from './space-detection'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

function editorStoreStub() {
  const state = {
    spaces: {} as Record<string, Space>,
    setSpaces(spaces: Record<string, Space>) {
      state.spaces = spaces
    },
  }
  return { getState: () => state }
}

function resetRoom() {
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
    parentId: null,
    children: [level.id],
  })
  const nodes = Object.fromEntries(
    [building, level, ...walls].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  useScene.setState({
    nodes,
    rootNodeIds: [building.id],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
}

describe('space topology index undo and redo', () => {
  afterEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    clearSceneHistory()
  })

  test('rebuilds its disposable room lookup after undo and redo', async () => {
    resetRoom()
    const editorStore = editorStoreStub()
    const unsubscribe = initSpaceDetectionSync(useScene, editorStore)

    try {
      expect(Object.keys(editorStore.getState().spaces)).toHaveLength(1)

      useScene.getState().createNode(
        WallNode.parse({
          id: 'wall_divider',
          start: [2, 0],
          end: [2, 3],
          parentId: 'level_0',
        }),
        'level_0',
      )
      expect(Object.keys(editorStore.getState().spaces)).toHaveLength(2)

      useScene.temporal.getState().undo()
      await Promise.resolve()
      expect(Object.keys(editorStore.getState().spaces)).toHaveLength(1)

      useScene.temporal.getState().redo()
      await Promise.resolve()
      expect(Object.keys(editorStore.getState().spaces)).toHaveLength(2)
    } finally {
      unsubscribe()
    }
  })
})
