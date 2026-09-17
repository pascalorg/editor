import { beforeEach, describe, expect, test } from 'bun:test'
import { isWallTypingKey, useWallDraftTyping } from './use-wall-draft-typing'

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

  test('clearInput empties the buffer', () => {
    const typing = useWallDraftTyping.getState()
    typing.append('5')
    typing.clearInput()
    expect(useWallDraftTyping.getState().input).toBe('')
  })

  test('begin resets the buffer for a new draft', () => {
    const typing = useWallDraftTyping.getState()
    typing.append('9')
    useWallDraftTyping.getState().begin()
    expect(useWallDraftTyping.getState().input).toBe('')
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
