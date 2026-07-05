import { beforeEach, describe, expect, test } from 'bun:test'
import { sanitizeLiveDataSnapshot, useLiveData } from './live-data-store'

describe('live data store', () => {
  beforeEach(() => {
    useLiveData.getState().resetLiveData()
  })

  test('sanitizes snapshots before merging live values', () => {
    const sanitized = sanitizeLiveDataSnapshot({
      seq: Number.POSITIVE_INFINITY,
      timestamp: 123,
      values: {
        'factory.temperature': 42,
        'factory.running': true,
        'factory.name': 'Pump A',
        'factory.badNumber': Number.NaN,
        'factory.object': { nested: 1 } as never,
        'factory.array': [1, 2] as never,
        '': 99,
      },
    })

    expect(sanitized.rejectedCount).toBe(4)
    expect(sanitized.snapshot).toEqual({
      timestamp: 123,
      values: {
        'factory.temperature': 42,
        'factory.running': true,
        'factory.name': 'Pump A',
      },
    })
  })

  test('does not let invalid websocket values overwrite previous safe values', () => {
    useLiveData.getState().setSnapshot({
      values: {
        'factory.temperature': 42,
      },
    })

    useLiveData.getState().setSnapshot({
      values: {
        'factory.temperature': Number.POSITIVE_INFINITY,
        'factory.status': { bad: true } as never,
      },
    })

    const state = useLiveData.getState()
    expect(state.status).toBe('connected')
    expect(state.values['factory.temperature']).toBe(42)
    expect(state.values['factory.status']).toBeUndefined()
    expect(state.error).toBe('Ignored 2 invalid live data values.')
  })
})
