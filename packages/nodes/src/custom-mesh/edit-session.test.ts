import { beforeEach, describe, expect, test } from 'bun:test'
import { createBoxCustomMeshTopology } from '@pascal-app/core'
import useCustomMeshEditSession from './edit-session'
import { createCustomMeshSelection } from './selection-model'

describe('custom mesh edit session', () => {
  beforeEach(() => {
    useCustomMeshEditSession.setState({
      nodeId: null,
      selection: createCustomMeshSelection('face'),
      activeMaterialSlotId: null,
    })
  })

  test('owns one transient selection session at a time', () => {
    const first = createCustomMeshSelection('face', ['f-top'])
    useCustomMeshEditSession.getState().begin('custom-mesh_1', first)
    expect(useCustomMeshEditSession.getState()).toMatchObject({
      nodeId: 'custom-mesh_1',
      selection: first,
    })

    const second = createCustomMeshSelection('edge', ['e0'])
    useCustomMeshEditSession.getState().begin('custom-mesh_2', second)
    expect(useCustomMeshEditSession.getState()).toMatchObject({
      nodeId: 'custom-mesh_2',
      selection: second,
    })
  })

  test('rejects selection writes and cleanup from a non-owner', () => {
    const selection = createCustomMeshSelection('face', ['f-top'])
    useCustomMeshEditSession.getState().begin('custom-mesh_1', selection)
    useCustomMeshEditSession
      .getState()
      .setSelection('custom-mesh_2', createCustomMeshSelection('vertex', ['v0']))
    useCustomMeshEditSession.getState().setActiveMaterialSlot('custom-mesh_2', 'accent')
    useCustomMeshEditSession.getState().end('custom-mesh_2')

    expect(useCustomMeshEditSession.getState()).toMatchObject({
      nodeId: 'custom-mesh_1',
      selection,
      activeMaterialSlotId: null,
    })
  })

  test('reconciles removed component IDs and preserves a valid active component', () => {
    const topology = createBoxCustomMeshTopology()
    useCustomMeshEditSession.getState().begin('custom-mesh_1', {
      mode: 'face',
      ids: ['f-bottom', 'missing', 'f-top'],
      activeId: 'missing',
    })
    useCustomMeshEditSession.getState().reconcileSelection('custom-mesh_1', topology)

    expect(useCustomMeshEditSession.getState().selection).toEqual({
      mode: 'face',
      ids: ['f-bottom', 'f-top'],
      activeId: 'f-top',
    })
  })

  test('ends only the owned session and resets transient selection', () => {
    useCustomMeshEditSession
      .getState()
      .begin('custom-mesh_1', createCustomMeshSelection('face', ['f-top']))
    useCustomMeshEditSession.getState().setActiveMaterialSlot('custom-mesh_1', 'accent')
    useCustomMeshEditSession.getState().end('custom-mesh_1')

    expect(useCustomMeshEditSession.getState()).toMatchObject({
      nodeId: null,
      selection: { mode: 'face', ids: [], activeId: null },
      activeMaterialSlotId: null,
    })
  })
})
