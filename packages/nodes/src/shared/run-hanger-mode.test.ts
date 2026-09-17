import { beforeEach, describe, expect, test } from 'bun:test'
import { ductSegmentDefinition } from '../duct-segment/definition'
import { pipeSegmentDefinition } from '../pipe-segment/definition'
import { createRunHangerToolHint, useRunHangerMode } from './run-hanger-mode'

beforeEach(() => {
  useRunHangerMode.setState({
    enabled: {
      'duct-segment': false,
      'pipe-segment': false,
    },
  })
})

describe('run hanger mode', () => {
  test('toggles each run tool independently', () => {
    const ductHint = createRunHangerToolHint('duct-segment')
    const pipeHint = createRunHangerToolHint('pipe-segment')

    expect(ductHint.chip?.value()).toBe('off')
    expect(pipeHint.chip?.value()).toBe('off')

    ductHint.chip?.cycle()

    expect(ductHint.chip?.value()).toBe('on')
    expect(pipeHint.chip?.value()).toBe('off')
  })

  test('registers the live H shortcut on duct and DWV drawing tools', () => {
    for (const definition of [ductSegmentDefinition, pipeSegmentDefinition]) {
      const hint = definition.toolHints?.find((candidate) => candidate.key === 'H')
      expect(hint?.chip?.labels).toEqual({
        off: 'Auto hangers: Off',
        on: 'Auto hangers: On',
      })
    }
  })

  test('notifies the contextual helper when the active value changes', () => {
    const hint = createRunHangerToolHint('pipe-segment')
    let changes = 0
    const unsubscribe = hint.chip?.subscribe(() => {
      changes += 1
    })

    useRunHangerMode.getState().toggle('duct-segment')
    useRunHangerMode.getState().toggle('pipe-segment')
    unsubscribe?.()

    expect(changes).toBe(1)
  })
})
