import { beforeEach, describe, expect, test } from 'bun:test'
import { getContextualHelpNodeExtension } from '@pascal-app/editor'
import { customMeshDefinition } from './definition'
import useCustomMeshEditSession from './edit-session'
import { createCustomMeshSelection } from './selection-model'

describe('custom mesh contextual help', () => {
  beforeEach(() => {
    useCustomMeshEditSession.setState({
      nodeId: null,
      selection: createCustomMeshSelection('face'),
      activeMaterialSlotId: null,
    })
  })

  test('tracks the active component mode and its shortcuts', () => {
    const extension = getContextualHelpNodeExtension(customMeshDefinition)
    expect(extension).toBeDefined()

    useCustomMeshEditSession
      .getState()
      .begin('custom-mesh_1', createCustomMeshSelection('face', ['f-top']))
    expect(extension?.getHints('custom-mesh_1')).toContainEqual({
      keys: [['1', '2', '3']],
      label: 'Face mode',
      subtitle: 'Vertex / Edge / Face',
    })
    expect(extension?.getHints('custom-mesh_1')).toContainEqual({
      keys: ['E'],
      label: 'Extrude selected faces',
    })

    useCustomMeshEditSession
      .getState()
      .setSelection('custom-mesh_1', createCustomMeshSelection('edge', ['e0']))
    expect(extension?.getHints('custom-mesh_1')).toContainEqual({
      keys: ['Cmd/Ctrl', 'B'],
      label: 'Bevel selected edges',
    })
    expect(extension?.getHints('another-node')).toEqual([])
  })
})
