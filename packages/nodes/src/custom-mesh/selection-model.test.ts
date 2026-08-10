import { describe, expect, test } from 'bun:test'
import { createBoxCustomMeshTopology } from '@pascal-app/core'
import {
  convertCustomMeshSelection,
  createCustomMeshSelection,
  invertCustomMeshSelection,
  selectAllCustomMeshComponents,
  selectCustomMeshComponent,
} from './selection-model'

describe('custom mesh component selection', () => {
  const topology = createBoxCustomMeshTopology()

  test('tracks the last selected component as active and supports toggling', () => {
    let selection = createCustomMeshSelection('vertex')
    selection = selectCustomMeshComponent(selection, 'v0', false)
    selection = selectCustomMeshComponent(selection, 'v1', true)
    expect(selection).toEqual({ mode: 'vertex', ids: ['v0', 'v1'], activeId: 'v1' })

    selection = selectCustomMeshComponent(selection, 'v1', true)
    expect(selection).toEqual({ mode: 'vertex', ids: ['v0'], activeId: 'v0' })
  })

  test('converts face selection through topology instead of discarding it', () => {
    const face = createCustomMeshSelection('face', ['f-top'])
    const vertices = convertCustomMeshSelection(topology, face, 'vertex')
    expect(vertices.ids).toEqual(['v4', 'v5', 'v6', 'v7'])

    const edges = convertCustomMeshSelection(topology, face, 'edge')
    expect(edges.ids).toEqual(['e4', 'e5', 'e6', 'e7'])
  })

  test('select all and invert operate on the active component domain', () => {
    const all = selectAllCustomMeshComponents(topology, createCustomMeshSelection('face'))
    expect(all.ids).toHaveLength(6)
    expect(invertCustomMeshSelection(topology, all).ids).toEqual([])

    const inverse = invertCustomMeshSelection(
      topology,
      createCustomMeshSelection('edge', ['e0', 'e1']),
    )
    expect(inverse.ids).toHaveLength(10)
    expect(inverse.ids).not.toContain('e0')
  })
})
