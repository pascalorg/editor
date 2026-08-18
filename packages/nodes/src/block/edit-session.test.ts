import { beforeEach, describe, expect, test } from 'bun:test'
import { createBoxBlockTopology } from '@pascal-app/core'
import useBlockEditSession from './edit-session'
import { createBlockSelection } from './selection-model'

describe('block edit session', () => {
  beforeEach(() => {
    useBlockEditSession.setState({
      nodeId: null,
      selection: createBlockSelection('face'),
      activeMaterialSlotId: null,
    })
  })

  test('owns one transient selection session at a time', () => {
    const first = createBlockSelection('face', ['f-top'])
    useBlockEditSession.getState().begin('block_1', first)
    expect(useBlockEditSession.getState()).toMatchObject({
      nodeId: 'block_1',
      selection: first,
    })

    const second = createBlockSelection('edge', ['e0'])
    useBlockEditSession.getState().begin('block_2', second)
    expect(useBlockEditSession.getState()).toMatchObject({
      nodeId: 'block_2',
      selection: second,
    })
  })

  test('rejects selection writes and cleanup from a non-owner', () => {
    const selection = createBlockSelection('face', ['f-top'])
    useBlockEditSession.getState().begin('block_1', selection)
    useBlockEditSession.getState().setSelection('block_2', createBlockSelection('vertex', ['v0']))
    useBlockEditSession.getState().setActiveMaterialSlot('block_2', 'accent')
    useBlockEditSession.getState().end('block_2')

    expect(useBlockEditSession.getState()).toMatchObject({
      nodeId: 'block_1',
      selection,
      activeMaterialSlotId: null,
    })
  })

  test('reconciles removed component IDs and preserves a valid active component', () => {
    const topology = createBoxBlockTopology()
    useBlockEditSession.getState().begin('block_1', {
      mode: 'face',
      ids: ['f-bottom', 'missing', 'f-top'],
      activeId: 'missing',
    })
    useBlockEditSession.getState().reconcileSelection('block_1', topology)

    expect(useBlockEditSession.getState().selection).toEqual({
      mode: 'face',
      ids: ['f-bottom', 'f-top'],
      activeId: 'f-top',
    })
  })

  test('ends only the owned session and resets transient selection', () => {
    useBlockEditSession.getState().begin('block_1', createBlockSelection('face', ['f-top']))
    useBlockEditSession.getState().setActiveMaterialSlot('block_1', 'accent')
    useBlockEditSession.getState().end('block_1')

    expect(useBlockEditSession.getState()).toMatchObject({
      nodeId: null,
      selection: { mode: 'face', ids: [], activeId: null },
      activeMaterialSlotId: null,
    })
  })
})
