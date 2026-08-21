import { describe, expect, test } from 'bun:test'
import { createBoxBlockTopology } from '@pascal-app/core'
import {
  convertBlockSelection,
  createBlockSelection,
  invertBlockSelection,
  selectAllBlockComponents,
  selectBlockComponent,
} from './selection-model'

describe('block component selection', () => {
  const topology = createBoxBlockTopology()

  test('tracks the last selected component as active and supports toggling', () => {
    let selection = createBlockSelection('vertex')
    selection = selectBlockComponent(selection, 'v0', false)
    selection = selectBlockComponent(selection, 'v1', true)
    expect(selection).toEqual({ mode: 'vertex', ids: ['v0', 'v1'], activeId: 'v1' })

    selection = selectBlockComponent(selection, 'v1', true)
    expect(selection).toEqual({ mode: 'vertex', ids: ['v0'], activeId: 'v0' })
  })

  test('converts face selection through topology instead of discarding it', () => {
    const face = createBlockSelection('face', ['f-top'])
    const vertices = convertBlockSelection(topology, face, 'vertex')
    expect(vertices.ids).toEqual(['v4', 'v5', 'v6', 'v7'])

    const edges = convertBlockSelection(topology, face, 'edge')
    expect(edges.ids).toEqual(['e4', 'e5', 'e6', 'e7'])
  })

  test('select all and invert operate on the active component domain', () => {
    const all = selectAllBlockComponents(topology, createBlockSelection('face'))
    expect(all.ids).toHaveLength(6)
    expect(invertBlockSelection(topology, all).ids).toEqual([])

    const inverse = invertBlockSelection(topology, createBlockSelection('edge', ['e0', 'e1']))
    expect(inverse.ids).toHaveLength(10)
    expect(inverse.ids).not.toContain('e0')
  })
})
