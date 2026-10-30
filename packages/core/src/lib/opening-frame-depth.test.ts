import { expect, test } from 'bun:test'
import { DoorNode, WallNode, WindowNode } from '../schema'
import {
  isAutoFrameDepth,
  resolveHostedOpeningFrameDepth,
  resolveOpeningFrameDepth,
} from './opening-frame-depth'

test('auto depth is exactly the wall thickness for doors and windows', () => {
  const door = DoorNode.parse({ id: 'door_auto', position: [1, 1.05, 0] })
  const window = WindowNode.parse({ id: 'window_auto', position: [1, 1.5, 0] })
  expect(isAutoFrameDepth(door)).toBe(true)
  expect(isAutoFrameDepth(window)).toBe(true)
  expect(resolveOpeningFrameDepth(door, 0.2)).toBeCloseTo(0.2, 9)
  expect(resolveOpeningFrameDepth(window, 0.1)).toBeCloseTo(0.1, 9)
  expect(resolveOpeningFrameDepth(window, 0.35)).toBeCloseTo(0.35, 9)
  expect(resolveOpeningFrameDepth({ ...window, frameDepth: 0.07 }, 0.35)).toBe(0.07)
  expect(resolveOpeningFrameDepth(door, 0.35)).toBeCloseTo(0.35, 9)
})

test('an explicit frame depth stays whatever the wall is', () => {
  const door = DoorNode.parse({ id: 'door_fixed', position: [1, 1.05, 0], frameDepth: 0.07 })
  expect(isAutoFrameDepth(door)).toBe(false)
  expect(resolveOpeningFrameDepth(door, 0.2)).toBe(0.07)
  expect(resolveOpeningFrameDepth(door, 0.35)).toBe(0.07)
})

test('an old scene keeps its stored depth through a parse', () => {
  const stored = { type: 'door', id: 'door_old', position: [1, 1.05, 0], frameDepth: 0.07 }
  expect(DoorNode.parse(stored).frameDepth).toBe(0.07)
  expect(DoorNode.parse({ type: 'door', id: 'door_new', position: [1, 1.05, 0] }).frameDepth).toBe(
    undefined,
  )
})

test('a hosted opening resolves against its parent wall, and re-resolves on a thicker one', () => {
  const thin = WallNode.parse({ id: 'wall_thin', start: [0, 0], end: [4, 0], thickness: 0.1 })
  const thick = WallNode.parse({ id: 'wall_thick', start: [0, 4], end: [4, 4], thickness: 0.3 })
  const nodes = { [thin.id]: thin, [thick.id]: thick }
  const door = DoorNode.parse({ id: 'door_hosted', parentId: thin.id, position: [2, 1.05, 0] })
  expect(resolveHostedOpeningFrameDepth(door, nodes)).toBeCloseTo(0.1, 9)
  expect(resolveHostedOpeningFrameDepth({ ...door, parentId: thick.id }, nodes)).toBeCloseTo(0.3, 9)
  // Off a wall (a roof face, a preview with no parent) the default wall thickness stands in.
  expect(resolveHostedOpeningFrameDepth({ ...door, parentId: undefined }, nodes)).toBeCloseTo(
    0.1,
    9,
  )
  expect(resolveHostedOpeningFrameDepth({ ...door, frameDepth: 0.07 }, nodes)).toBe(0.07)
  const window = WindowNode.parse({ parentId: thin.id })
  expect(resolveHostedOpeningFrameDepth(window, nodes)).toBe(0.1)
  expect(resolveHostedOpeningFrameDepth({ ...window, parentId: thick.id }, nodes)).toBe(0.3)
})
