import { expect, test } from 'bun:test'
import {
  COLUMN_PRESETS,
  ColumnNode,
  type ColumnPresetId,
  clearSceneHistory,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { installMountedScene } from '../__tests__/harness'
import { columnPresetUpdates, columnSectionReset } from './presets'
import { createColumnPropertyPreview } from './property-preview'

installMountedScene()

test('all shape presets preserve identity, placement and finishes', () => {
  const original = ColumnNode.parse({
    name: 'Entrance pillar',
    position: [2, 0, 4],
    materialPreset: 'concrete',
    slots: { shaft: 'library:stone' },
  })
  for (const id of Object.keys(COLUMN_PRESETS) as ColumnPresetId[]) {
    const result = ColumnNode.parse({ ...original, ...columnPresetUpdates(id) })
    expect(result).toMatchObject({
      id: original.id,
      name: original.name,
      position: original.position,
      materialPreset: original.materialPreset,
      slots: original.slots,
    })
  }
})

test('section resets are isolated and material reset clears all finish overrides', () => {
  const original = ColumnNode.parse({
    height: 4,
    baseHeight: 0.4,
    capitalHeight: 0.5,
    materialPreset: 'concrete',
    slots: { shaft: 'library:stone' },
  })
  const base = ColumnNode.parse({ ...original, ...columnSectionReset('Base') })
  expect(base.baseHeight).toBe(ColumnNode.parse({}).baseHeight)
  expect(base.height).toBe(4)
  expect(base.capitalHeight).toBe(0.5)
  expect(base.slots).toEqual(original.slots)
  const finish = ColumnNode.parse({ ...original, ...columnSectionReset('Materials') })
  expect(finish.material).toBeUndefined()
  expect(finish.materialPreset).toBeUndefined()
  expect(finish.slots).toBeUndefined()
  expect(finish.height).toBe(4)
})

test('switching preset previews cancels cleanly and applying is one undoable edit', () => {
  const original = ColumnNode.parse({ name: 'Keep name', materialPreset: 'concrete' })
  useScene.setState({ nodes: { [original.id]: original }, dirtyNodes: new Set(), readOnly: false })
  clearSceneHistory()
  const preview = createColumnPropertyPreview(original.id)
  const ids = Object.keys(COLUMN_PRESETS) as ColumnPresetId[]
  preview.preview(columnPresetUpdates(ids[1]!))
  expect(useScene.getState().nodes[original.id]).toBe(original)
  preview.cancel()
  expect(useLiveNodeOverrides.getState().get(original.id)).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  preview.preview(columnPresetUpdates(ids[2]!))
  preview.commit()
  expect(useScene.getState().nodes[original.id]).toMatchObject({
    name: 'Keep name',
    materialPreset: 'concrete',
    ...columnPresetUpdates(ids[2]!),
  })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[original.id]).toEqual(original)
})

test('material reset clears persisted finishes and undo restores them', () => {
  const original = ColumnNode.parse({
    materialPreset: 'concrete',
    slots: { shaft: 'library:stone' },
  })
  useScene.setState({ nodes: { [original.id]: original }, dirtyNodes: new Set(), readOnly: false })
  clearSceneHistory()
  const preview = createColumnPropertyPreview(original.id)
  preview.preview(columnSectionReset('Materials'))
  preview.commit()
  const changed = useScene.getState().nodes[original.id] as ColumnNode
  expect(changed.materialPreset).toBeUndefined()
  expect(changed.slots).toBeUndefined()
  expect(changed.height).toBe(original.height)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[original.id]).toEqual(original)
})
