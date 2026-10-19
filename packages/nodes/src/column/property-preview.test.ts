import { expect, test } from 'bun:test'
import {
  ColumnNode,
  clearSceneHistory,
  ItemNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { boxAsset, installMountedScene } from '../__tests__/harness'
import { createColumnPropertyPreview } from './property-preview'
import { columnTopSurfaces } from './surface'

installMountedScene()
function seed() {
  const host = ColumnNode.parse({
    crossSection: 'rectangular',
    width: 1,
    depth: 1,
    capitalStyle: 'simple',
    height: 2,
  })
  const child = ItemNode.parse({
    parentId: host.id,
    asset: boxAsset,
    position: [0.2, columnTopSurfaces(host)[0]!.position[1], 0],
  })
  host.children = [child.id]
  useScene.setState({
    nodes: { [host.id]: host, [child.id]: child },
    dirtyNodes: new Set(),
    readOnly: false,
  })
  clearSceneHistory()
  return { host, child, preview: createColumnPropertyPreview(host.id) }
}
test('inspector height previews carry hosted children without scene writes and commit one undo step', () => {
  const { host, child, preview } = seed()
  const baseline = useScene.getState().nodes
  preview.preview({ height: 3 })
  preview.preview({ height: 4 })
  expect(useScene.getState().nodes).toBe(baseline)
  expect(useLiveNodeOverrides.getState().get(host.id)?.height).toBe(4)
  expect(useLiveNodeOverrides.getState().get(child.id)?.position).toEqual([0.2, 4, 0])
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  preview.commit()
  expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
  expect(useScene.getState().nodes[host.id]).toMatchObject({ height: 4 })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[host.id]).toEqual(host)
  expect(useScene.getState().nodes[child.id]).toEqual(child)
})
test('cancelling a property preview restores both nodes and preserves unrelated override fields', () => {
  const { host, child, preview } = seed()
  const baseline = useScene.getState().nodes
  useLiveNodeOverrides.getState().set(host.id, { visible: false })
  preview.preview({ height: 3 })
  preview.cancel()
  expect(useScene.getState().nodes).toBe(baseline)
  expect(useLiveNodeOverrides.getState().get(host.id)).toEqual({ visible: false })
  expect(useLiveNodeOverrides.getState().get(child.id)).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
test('a rejected resize retains the last valid preview and a no-op produces no undo', () => {
  const { host, preview } = seed()
  preview.preview({ height: host.height })
  preview.commit()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  preview.preview({ width: 0.8 })
  preview.preview({ width: 0.01 })
  expect(useLiveNodeOverrides.getState().get(host.id)?.width).toBe(0.8)
  preview.commit()
  expect(useScene.getState().nodes[host.id]).toMatchObject({ width: 0.8 })
})
