import { beforeEach, describe, expect, test } from 'bun:test'
import { getContextualHelpNodeExtension } from '@pascal-app/editor'
import { blockDefinition } from './definition'
import useBlockEditSession from './edit-session'
import { createBlockSelection } from './selection-model'

describe('block contextual help', () => {
  beforeEach(() => {
    useBlockEditSession.setState({
      nodeId: null,
      selection: createBlockSelection('face'),
    })
  })

  test('tracks the active component mode and its shortcuts', () => {
    const extension = getContextualHelpNodeExtension(blockDefinition)
    expect(extension).toBeDefined()

    useBlockEditSession.getState().begin('block_1', createBlockSelection('face', ['f-top']))
    expect(extension?.getHints('block_1')).toContainEqual({
      keys: [['1', '2', '3']],
      label: 'Face mode',
      subtitle: 'Vertex / Edge / Face',
    })
    expect(extension?.getHints('block_1')).toContainEqual({
      keys: ['E'],
      label: 'Extrude selected faces',
    })

    useBlockEditSession.getState().setSelection('block_1', createBlockSelection('edge', ['e0']))
    expect(extension?.getHints('block_1')).toContainEqual({
      keys: ['Cmd/Ctrl', 'B'],
      label: 'Bevel selected edges',
    })
    expect(extension?.getHints('another-node')).toEqual([])
  })
})
