import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  LevelNode,
  nodeRegistry,
  PipeSegmentNode,
  registerNode,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  copyCollectionIds,
  duplicateNodeAndPickUp,
} from '../../../editor/src/components/editor/duplicate-node'
import { duplicateNodesToLevel } from '../../../editor/src/lib/scene-clipboard'
import useInteractionScope, { getMovingNode } from '../../../editor/src/store/use-interaction-scope'
import { pipeSegmentDefinition } from '../pipe-segment/definition'

const level = LevelNode.parse({ id: 'level_dup', level: 0 })
const wall = WallNode.parse({ id: 'wall_dup', parentId: level.id, start: [0, 0], end: [6, 0] })
const window = WindowNode.parse({
  id: 'window_dup',
  parentId: wall.id,
  wallId: wall.id,
  position: [2, 1, 0],
})
const pipe = PipeSegmentNode.parse({
  id: 'pipe-segment_dup',
  parentId: level.id,
  path: [
    [0, 0.5, 1],
    [3, 0.5, 1],
  ],
})

let restore: () => void

beforeEach(() => {
  const scene = useScene.getState()
  const viewer = useViewer.getState()
  const scope = useInteractionScope.getState()
  const restoreRegistry = nodeRegistry._snapshot()
  restore = () => {
    useScene.setState(scene, true)
    useViewer.setState(viewer, true)
    useInteractionScope.setState(scope, true)
    restoreRegistry()
  }
  registerNode(pipeSegmentDefinition as never)
  useScene.getState().setScene(
    {
      [level.id]: { ...level, children: [wall.id, pipe.id] },
      [wall.id]: { ...wall, children: [window.id] },
      [window.id]: window,
      [pipe.id]: pipe,
    } as never,
    [level.id],
  )
  useViewer.getState().setSelection({ levelId: level.id, selectedIds: [] })
})

afterEach(() => restore())

test('every Duplicate puts the copy in the collections its source is in', () => {
  const collectionId = useScene.getState().createCollection('Facade', [window.id, pipe.id])
  const members = () => useScene.getState().collections[collectionId]!.nodeIds

  // A copy drafted in the scene (a window) is a member from its draft on.
  duplicateNodeAndPickUp(window)
  const windowCopy = getMovingNode()!
  expect(useScene.getState().nodes[windowCopy.id as AnyNodeId]).toBeDefined()
  expect(members()).toContain(windowCopy.id)
  useInteractionScope.getState().end()

  // A copy carried outside the scene (a pipe run) joins when its tool creates it.
  duplicateNodeAndPickUp(pipe)
  const pipeCopy = getMovingNode()!
  expect(useScene.getState().nodes[pipeCopy.id as AnyNodeId]).toBeUndefined()
  useScene
    .getState()
    .createNodes([
      { node: pipeCopy, parentId: level.id, collectionIds: copyCollectionIds(pipeCopy) },
    ])
  expect(members()).toContain(pipeCopy.id)
  useInteractionScope.getState().end()

  // Duplicating a selection does the same for every kind, hosted children included.
  const [wallCopyId, pipeCopyId] = duplicateNodesToLevel([wall.id, pipe.id], level.id)!.pastedIds
  const wallCopy = useScene.getState().nodes[wallCopyId!] as WallNode
  expect(members()).not.toContain(wallCopyId)
  expect(members()).toContain(wallCopy.children[0])
  expect(members()).toContain(pipeCopyId)
})
