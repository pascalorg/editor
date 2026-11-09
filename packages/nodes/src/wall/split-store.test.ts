import { afterEach, beforeEach, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode, WindowNode } from '@pascal-app/core'
import { getActiveSnapContext, useInteractionScope } from '@pascal-app/editor'
import {
  closeWallSplit,
  commitWallSplit,
  hoverWallSplit,
  openWallSplit,
  setWallSplitCuts,
} from './split-session'
import { useWallSplit } from './split-store'

const level = LevelNode.parse({ children: [] })
const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
const window = WindowNode.parse({
  parentId: wall.id,
  wallId: wall.id,
  position: [6, 1.5, 0],
  width: 1,
})
level.children = [wall.id]
wall.children = [window.id]
beforeEach(() => {
  closeWallSplit()
  useScene.setState({
    nodes: { [level.id]: level, [wall.id]: wall, [window.id]: window },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
})
afterEach(() => {
  closeWallSplit()
  useScene.setState({ readOnly: false })
})

test("a split session is the wall's reshaping scope and a snapping context, one centred cut", () => {
  openWallSplit(wall)
  expect(useInteractionScope.getState().scope).toMatchObject({
    kind: 'reshaping',
    nodeId: wall.id,
    reshape: 'split',
  })
  expect(getActiveSnapContext()).toBe('polygon')
  expect(useWallSplit.getState().draft?.preview.distances).toEqual([4])
})
test('hover and cut-count changes are ephemeral; cancel does not alter nodes or undo', () => {
  const before = useScene.getState().nodes
  openWallSplit(wall)
  for (let distance = 1; distance < 4; distance += 0.1) hoverWallSplit(distance, true)
  setWallSplitCuts(3)
  setWallSplitCuts(99)
  expect(useWallSplit.getState().draft?.cuts).toBe(32)
  expect(useScene.getState().nodes).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  closeWallSplit()
  expect(useWallSplit.getState().draft).toBeNull()
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
})
test('commit uses the displayed mark, reparents openings and is one undo', () => {
  const before = useScene.getState().nodes
  openWallSplit(wall)
  hoverWallSplit(3.25, true)
  commitWallSplit()
  const after = useScene.getState().nodes
  expect((after[wall.id] as WallNode).end).toEqual([3.25, 0])
  expect((after[window.id] as WindowNode).position).toEqual([2.75, 1.5, 0])
  expect(useWallSplit.getState().draft).toBeNull()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})
test('even cuts commit as a single undo step', () => {
  openWallSplit(wall)
  setWallSplitCuts(2)
  commitWallSplit()
  const walls = Object.values(useScene.getState().nodes).filter(
    (node): node is WallNode => node.type === 'wall',
  )
  expect(walls.map((w) => w.end[0] - w.start[0]).map((l) => Number(l.toFixed(6)))).toEqual(
    [8 / 3, 8 / 3, 8 / 3].map((l) => Number(l.toFixed(6))),
  )
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})
test('invalid opening cuts, replaced scopes and read-only transitions cannot commit', () => {
  const before = useScene.getState().nodes
  openWallSplit(wall)
  hoverWallSplit(6, true)
  commitWallSplit()
  expect(useWallSplit.getState().draft?.preview.valid).toBe(false)
  expect(useScene.getState().nodes).toBe(before)
  hoverWallSplit(3, true)
  useScene.setState({ readOnly: true })
  commitWallSplit()
  expect(useScene.getState().nodes).toBe(before)
  useScene.setState({ readOnly: false })
  useInteractionScope.getState().begin({ kind: 'painting' })
  commitWallSplit()
  closeWallSplit()
  expect(useScene.getState().nodes).toBe(before)
  expect(useInteractionScope.getState().scope.kind).toBe('painting')
  useInteractionScope.getState().end()
})
