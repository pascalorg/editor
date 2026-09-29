import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  structureChangeBatch,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { installImmediateAnimationFrames } from '../../../editor/src/test-utils/immediate-animation-frames'
import { closeWallSplit, commitWallSplit, openWallSplit } from './split-session'

// UX round point 3: a committed Split on a wall drilled from a room lands back
// on the room; cancelling keeps the wall.

const LEVEL = 'level_split_return'
let zoneId: string
let stop = () => {}
let restoreFrames = () => {}

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  closeWallSplit()
  const building = BuildingNode.parse({ id: 'building_split_return', children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  const plan = createZone(useScene.getState().nodes, {
    levelId: LEVEL,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
    enclose: true,
    mintId: generateId,
  })
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  zoneId = plan.zoneId
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  useEditor.setState({ phase: 'structure', mode: 'select', room: { levelId: LEVEL, zoneId } })
  clearSceneHistory()
})
afterEach(() => {
  closeWallSplit()
  stop()
  restoreFrames()
})

const drillWall = () => {
  const wall = Object.values(useScene.getState().nodes).find(
    (node): node is WallNode => node.type === 'wall' && node.parentId === LEVEL,
  )!
  useViewer.getState().setSelection({ selectedIds: [wall.id as AnyNodeId] })
  return wall
}

test('a committed split returns to the room it was drilled from', () => {
  openWallSplit(drillWall())
  commitWallSplit()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId })
  expect(useViewer.getState().selection.selectedIds).toEqual([])
})

test('a cancelled split keeps the wall selected', () => {
  const wall = drillWall()
  openWallSplit(wall)
  closeWallSplit()
  expect(useViewer.getState().selection.selectedIds).toEqual([wall.id])
  expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId })
})

test('a wall with no room context keeps its first segment selected', () => {
  useEditor.setState({ room: null })
  const wall = drillWall()
  openWallSplit(wall)
  commitWallSplit()
  expect(useViewer.getState().selection.selectedIds).toEqual([wall.id])
})
