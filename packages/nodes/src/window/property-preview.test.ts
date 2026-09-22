import { afterEach, expect, test } from 'bun:test'
import { useLiveNodeOverrides, useScene, WallNode, WindowNode } from '@pascal-app/core'
import { createOpeningPropertyPreview } from '../shared/opening-property-preview'

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
  const preview = createOpeningPropertyPreview<WindowNode>(window.id)
  preview.preview({ width: 0.4, cornerRadius: 0.2 })
  expect(useScene.getState().nodes[window.id]).toBe(window)
  expect(window.cornerRadius).toBe(0.3)
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
  preview.preview({ width: 1.8, cornerRadius: 0.3 })
  preview.commit()
  expect(useScene.getState().nodes[window.id]).toMatchObject({ width: 1.8, cornerRadius: 0.3 })
  expect(useLiveNodeOverrides.getState().get(window.id)).toBeUndefined()
  preview.preview({ archHeight: 0.8 })
  preview.cancel()
  expect(useScene.getState().nodes[window.id]).toMatchObject({ archHeight: window.archHeight })
  expect(useLiveNodeOverrides.getState().get(window.id)).toBeUndefined()
})
