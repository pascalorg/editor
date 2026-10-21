import { afterEach, describe, expect, test } from 'bun:test'
import { ColumnNode, createSceneApi, useScene } from '@pascal-app/core'
import { columnDefinition } from './definition'
import { columnEditPatch } from './edit-policy'

const originalScene = useScene.getState()
afterEach(() => useScene.setState(originalScene, true))

describe('column definition', () => {
  test('keeps only user-owned handles for lean-to managed columns', () => {
    const column = ColumnNode.parse({
      metadata: {
        managedByLeanTo: 'lean_to_1',
        leanToRole: 'post',
      },
    })
    const handles =
      typeof columnDefinition.handles === 'function'
        ? columnDefinition.handles(column)
        : columnDefinition.handles

    expect(handles.map((handle) => handle.kind)).toEqual(['arc-resize'])
  })

  test('keeps brace and rotation handles for lean-to managed K-brace columns', () => {
    const column = ColumnNode.parse({
      supportStyle: 'k-brace',
      metadata: {
        managedByLeanTo: 'lean_to_1',
        leanToRole: 'post',
      },
    })
    const handles =
      typeof columnDefinition.handles === 'function'
        ? columnDefinition.handles(column)
        : columnDefinition.handles

    expect(handles.map((handle) => handle.kind)).toEqual([
      'linear-resize',
      'linear-resize',
      'arc-resize',
    ])
  })
})

test('round handle edits keep inspector dimensions in sync without rewriting the loaded node', () => {
  const column = ColumnNode.parse({ radius: 0.3, width: 0.44, depth: 0.44 })
  const handles =
    typeof columnDefinition.handles === 'function'
      ? columnDefinition.handles(column)
      : columnDefinition.handles!
  const radius = handles.find((h) => h.kind === 'radial-resize')!
  const scene = createSceneApi(useScene)
  useScene.setState({ nodes: { [column.id]: column } })
  expect(radius.apply(column, 0.5, scene)).toMatchObject({ radius: 0.5, width: 1, depth: 1 })
  expect(column.width).toBe(0.44)
})

test('switching to square normalizes both axes, and managed posts reject layout edits', () => {
  const column = ColumnNode.parse({ crossSection: 'rectangular', width: 1, depth: 2 })
  expect(columnEditPatch(column, { crossSection: 'square' })).toMatchObject({ width: 1, depth: 1 })
  const managed = { ...column, metadata: { managedByLeanTo: 'canopy', leanToRole: 'post' } }
  expect(
    columnEditPatch(managed, { width: 2, radius: 1, position: [1, 0, 0], rotation: 1 }),
  ).toEqual({ rotation: 1 })
  expect(columnDefinition.capabilities.movable?.override?.({ node: managed })).toBeNull()
})
