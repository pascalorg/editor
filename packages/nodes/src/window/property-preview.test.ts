import { afterEach, expect, test } from 'bun:test'
import { useLiveNodeOverrides, useScene, WallNode, WindowNode } from '@pascal-app/core'
import { createOpeningPropertyPreview } from '../shared/opening-property-preview'
import { openingPropertyPreviewHost } from '../shared/opening-property-preview-host'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const initial = useScene.getState()
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(initial)
})

test('window dimensions and curved-frame parameters preview without document mutation, then commit together', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], wallType: 'curtain' })
  const window = WindowNode.parse({
    parentId: wall.id,
    position: [3, 1.25, 0],
    openingShape: 'rounded',
    cornerRadius: 0.3,
  })
  useScene.setState({ nodes: { [wall.id]: wall, [window.id]: window }, dirtyNodes: new Set() })
  const preview = createOpeningPropertyPreview<WindowNode>(window.id, openingPropertyPreviewHost)
  preview.preview({ width: 0.4, cornerRadius: 0.2 })
  expect(useScene.getState().nodes[window.id]).toBe(window)
  expect(window.cornerRadius).toBe(0.3)
  preview.preview({ width: 1.8, cornerRadius: 0.3 })
  preview.commit()
  expect(useScene.getState().nodes[window.id]).toMatchObject({ width: 1.8, cornerRadius: 0.3 })
  expect(useLiveNodeOverrides.getState().get(window.id)).toBeUndefined()
  preview.preview({ archHeight: 0.8 })
  preview.cancel()
  expect(useScene.getState().nodes[window.id]).toMatchObject({ archHeight: window.archHeight })
  expect(useLiveNodeOverrides.getState().get(window.id)).toBeUndefined()
})

test('rapid opening previews rebuild once per frame and commit immediately', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], wallType: 'curtain' })
  const window = WindowNode.parse({
    parentId: wall.id,
    position: [3, 1.25, 0],
    openingShape: 'rounded',
    cornerRadius: 0.1,
  })
  useScene.setState({ nodes: { [wall.id]: wall, [window.id]: window }, dirtyNodes: new Set() })
  const frames = new Map<number, FrameRequestCallback>()
  const delays = new Map<number, () => void>()
  let nextFrame = 1
  let nextDelay = 1
  const preview = createOpeningPropertyPreview<WindowNode>(window.id, {
    ...openingPropertyPreviewHost,
    scheduleFrame: (callback) => {
      const handle = nextFrame++
      frames.set(handle, callback)
      return handle
    },
    cancelFrame: (handle) => frames.delete(handle),
    scheduleDelay: (callback, delay) => {
      expect(delay).toBe(100)
      const handle = nextDelay++
      delays.set(handle, callback)
      return handle
    },
    cancelDelay: (handle) => delays.delete(handle),
  })

  preview.preview({ cornerRadius: 0.2 })
  preview.preview({ cornerRadius: 0.3 })
  preview.preview({ cornerRadius: 0.4 })
  expect(frames.size).toBe(1)
  expect(useLiveNodeOverrides.getState().get(window.id)).toMatchObject({
    cornerRadius: 0.4,
    metadata: { deferParentRebuild: true },
  })
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(false)

  const [handle, frame] = frames.entries().next().value!
  frames.delete(handle)
  frame(0)
  expect(useScene.getState().dirtyNodes.has(window.id)).toBe(true)
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(false)
  expect(delays.size).toBe(1)

  const [delayHandle, delayedParent] = delays.entries().next().value!
  delays.delete(delayHandle)
  delayedParent()
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)

  useScene.setState({ dirtyNodes: new Set() })
  preview.preview({ cornerRadius: 0.5 })
  const [commitFrameHandle, commitFrame] = frames.entries().next().value!
  frames.delete(commitFrameHandle)
  commitFrame(0)
  expect(delays.size).toBe(1)
  preview.commit()
  expect(frames.size).toBe(0)
  expect(delays.size).toBe(0)
  expect(useScene.getState().nodes[window.id]).toMatchObject({ cornerRadius: 0.5 })
  expect(useLiveNodeOverrides.getState().get(window.id)).toBeUndefined()
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)

  useScene.setState({ dirtyNodes: new Set() })
  preview.preview({ cornerRadius: 0.6 })
  const [cancelFrameHandle, cancelFrame] = frames.entries().next().value!
  frames.delete(cancelFrameHandle)
  cancelFrame(0)
  expect(delays.size).toBe(1)
  preview.cancel()
  expect(frames.size).toBe(0)
  expect(delays.size).toBe(0)
  expect(useScene.getState().nodes[window.id]).toMatchObject({ cornerRadius: 0.5 })
  expect(useLiveNodeOverrides.getState().get(window.id)).toBeUndefined()
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
})

test('standard walls keep their opening and parent previews on the same frame', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0] })
  const window = WindowNode.parse({ parentId: wall.id, openingShape: 'rounded' })
  useScene.setState({ nodes: { [wall.id]: wall, [window.id]: window }, dirtyNodes: new Set() })
  const preview = createOpeningPropertyPreview<WindowNode>(window.id, {
    ...openingPropertyPreviewHost,
    scheduleFrame: (callback) => {
      callback(0)
      return 0
    },
  })

  preview.preview({ cornerRadius: 0.3 })

  expect(useScene.getState().dirtyNodes.has(window.id)).toBe(true)
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
  preview.cancel()
})
