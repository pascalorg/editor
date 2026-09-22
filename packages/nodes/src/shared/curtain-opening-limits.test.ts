import { afterEach, expect, test } from 'bun:test'
import {
  DoorNode,
  getEffectiveNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { constrainCurtainOpening, curtainOpeningLimits } from './curtain-opening-limits'
import { createOpeningPropertyPreview } from './opening-property-preview'
import { openingPropertyPreviewHost } from './opening-property-preview-host'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
const initial = useScene.getState()
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(initial)
  useScene.temporal.getState().clear()
})

const wall = WallNode.parse({ start: [0, 0], end: [10, 0], height: 2.5, wallType: 'curtain' })
const door = DoorNode.parse({ parentId: wall.id, position: [1.07, 1.05, 0] })
const nodes = { [wall.id]: wall, [door.id]: door }

test('door dimensions leave room for its surround and preserve its floor anchor', () => {
  const result = constrainCurtainOpening(door, { width: 3, height: 3.5 }, nodes)
  expect(result.width).toBeCloseTo(2.04)
  expect(result.height).toBeCloseTo(2.45)
  expect(result.position?.[1]).toBeCloseTo(1.225)
})

test('window grows about its center and position edits keep all four surrounds inside', () => {
  const window = WindowNode.parse({ parentId: wall.id, position: [5, 1.5, 0], width: 1, height: 1 })
  expect(curtainOpeningLimits(window, nodes)?.height).toBeCloseTo(1.9)
  const result = constrainCurtainOpening(window, { position: [-5, 4, 0] }, nodes)
  expect(result.position).toEqual([0.55, 1.9500000000000002, 0])
  expect(result.width).toBe(1)
  expect(result.height).toBe(1)
})

test('non-curtain hosts retain their existing sizing policy', () => {
  const patch = { width: 20 }
  expect(
    constrainCurtainOpening(door, patch, {
      ...nodes,
      [wall.id]: { ...wall, wallType: 'standard' },
    }),
  ).toBe(patch)
})

test('door drag writes no scene history until commit and undoes in one step', () => {
  useScene.setState({ nodes, dirtyNodes: new Set() })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const preview = createOpeningPropertyPreview<DoorNode>(door.id, openingPropertyPreviewHost)
  for (const width of [1.2, 1.5, 3]) preview.preview({ width })
  expect(useScene.getState().nodes[door.id]).toBe(door)
  expect(getEffectiveNode(door).width).toBeCloseTo(2.04)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  preview.commit({ width: 3 })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect((useScene.getState().nodes[door.id] as DoorNode).width).toBeCloseTo(2.04)
  useScene.temporal.getState().undo()
  expect((useScene.getState().nodes[door.id] as DoorNode).width).toBe(door.width)
  useScene.temporal.getState().redo()
  expect((useScene.getState().nodes[door.id] as DoorNode).width).toBeCloseTo(2.04)
})

test('cancel and a history-cleared preview cannot be committed by a stale release', () => {
  useScene.setState({ nodes, dirtyNodes: new Set() })
  const preview = createOpeningPropertyPreview<DoorNode>(door.id, openingPropertyPreviewHost)
  preview.preview({ height: 2.4 })
  preview.cancel()
  expect(getEffectiveNode(door).height).toBe(door.height)
  preview.preview({ height: 2.4 })
  useLiveNodeOverrides.getState().clearAll()
  preview.commit({ height: 2.4 })
  expect(useScene.getState().nodes[door.id]).toBe(door)
})
