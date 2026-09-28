import { beforeEach, describe, expect, test } from 'bun:test'
import { isWallTypingKey, resolveTypedCommitEnd, useWallDraftTyping } from './use-wall-draft-typing'

describe('useWallDraftTyping', () => {
  beforeEach(() => {
    useWallDraftTyping.getState().clearInput()
  })

  test('append accumulates a measurement buffer', () => {
    const typing = useWallDraftTyping.getState()
    typing.append('1')
    typing.append('8')
    typing.append('0')
    typing.append('c')
    typing.append('m')
    expect(useWallDraftTyping.getState().input).toBe('180cm')
  })

  test('backspace removes the last character', () => {
    const typing = useWallDraftTyping.getState()
    typing.append('2')
    typing.append('5')
    typing.backspace()
    expect(useWallDraftTyping.getState().input).toBe('2')
  })

  test('clearInput empties the buffer and the projected end', () => {
    const typing = useWallDraftTyping.getState()
    typing.append('5')
    typing.setProjectedEnd([1.5, 2.5])
    typing.clearInput()
    expect(useWallDraftTyping.getState().input).toBe('')
    expect(useWallDraftTyping.getState().projectedEnd).toBeNull()
  })

  test('setProjectedEnd stores the committed endpoint for click parity', () => {
    useWallDraftTyping.getState().setProjectedEnd([3.2, -0.4])
    expect(useWallDraftTyping.getState().projectedEnd).toEqual([3.2, -0.4])
  })
})

describe('resolveTypedCommitEnd', () => {
  const opts = { bareUnit: 'm', system: 'metric' } as const

  test('re-derives the endpoint from the buffer, not the stale preview length', () => {
    // Pointer last projected the "1" buffer (1 m east); user then typed "2"
    // without moving. The commit must be 12 m east, not 1 m.
    const end = resolveTypedCommitEnd([0, 0], [1, 0], '12', opts)
    expect(end).toEqual([12, 0])
  })

  test('normalizes the direction before applying the typed length', () => {
    // Stale preview end is 5 m along a 3-4-5 diagonal; typed 6 must scale the
    // unit vector, not add 6 to the stale endpoint.
    const end = resolveTypedCommitEnd([0, 0], [3, 4], '6', opts)
    expect(end).not.toBeNull()
    expect(end![0]).toBeCloseTo(3.6, 10)
    expect(end![1]).toBeCloseTo(4.8, 10)
  })

  test('honours unit suffixes in the buffer', () => {
    const end = resolveTypedCommitEnd([1, 1], [11, 1], '250cm', opts)
    expect(end).toEqual([3.5, 1])
  })

  test('returns null for empty, unparseable, or non-positive buffers', () => {
    expect(resolveTypedCommitEnd([0, 0], [1, 0], '', opts)).toBeNull()
    expect(resolveTypedCommitEnd([0, 0], [1, 0], 'abc', opts)).toBeNull()
    expect(resolveTypedCommitEnd([0, 0], [1, 0], '0', opts)).toBeNull()
  })

  test('returns null when the preview end is still on the start point', () => {
    expect(resolveTypedCommitEnd([2, 2], [2, 2], '5', opts)).toBeNull()
  })
})

describe('isWallTypingKey', () => {
  test('accepts digits, unit letters, and separators', () => {
    for (const key of ['0', '9', 'm', 'c', '.', "'", '"', '-', ' ']) {
      expect(isWallTypingKey(key)).toBe(true)
    }
  })

  test('rejects modifiers and multi-key names', () => {
    for (const key of ['Enter', 'Escape', 'Tab', 'Shift', '', 'F1']) {
      expect(isWallTypingKey(key)).toBe(false)
    }
  })
})
