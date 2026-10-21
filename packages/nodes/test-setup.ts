import { afterEach, beforeEach } from 'bun:test'
import { nodeRegistry, useLiveNodeOverrides, useLiveTransforms, useScene } from '@pascal-app/core'
import { useAlignmentGuides, useEditor, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

// bun runs every test file of this package in one process, in filesystem
// order, which differs between machines and shifts whenever a file is added.
// The node registry and these stores are module singletons, so a test that
// leaves them changed breaks whichever files happen to run next. Preload hooks
// wrap every test's own hooks: whatever a test or its `beforeEach` changes is
// undone before the next test starts. Tests that import a store from another
// package's `src` get a second instance, which this does not reach.
const stores = [
  useScene,
  useLiveNodeOverrides,
  useLiveTransforms,
  useViewer,
  useEditor,
  usePlacementPreview,
  useAlignmentGuides,
] as {
  getState(): object
  setState(state: object, replace: true): void
}[]

let restore = () => {}

beforeEach(() => {
  const restoreRegistry = nodeRegistry._snapshot()
  const states = stores.map((store) => store.getState())
  restore = () => {
    restoreRegistry()
    for (const [index, store] of stores.entries()) store.setState(states[index]!, true)
  }
})

afterEach(() => {
  restore()
})
