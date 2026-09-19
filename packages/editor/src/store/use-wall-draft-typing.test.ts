import { beforeEach, describe, expect, test } from 'bun:test'
import {
  isWallTypingKey,
  shouldArmFloorplanSpacePan,
  useWallDraftTyping,
} from './use-wall-draft-typing'

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
  test('empty buffer only starts on a digit or decimal point', () => {
    for (const key of ['0', '9', '.']) {
      expect(isWallTypingKey(key)).toBe(true)
      expect(isWallTypingKey(key, '')).toBe(true)
    }
    for (const key of ['m', 'c', 'f', ' ', "'", '"', '+', '-']) {
      expect(isWallTypingKey(key)).toBe(false)
      expect(isWallTypingKey(key, '')).toBe(false)
    }
  })

  test('non-empty buffer accepts digits, unit letters, and separators', () => {
    for (const key of ['0', '9', 'm', 'c', 'f', '.', "'", '"', '-', '+', ' ']) {
      expect(isWallTypingKey(key, '5')).toBe(true)
    }
  })

  test('rejects modifiers and multi-key names', () => {
    for (const key of ['Enter', 'Escape', 'Tab', 'Shift', '', 'F1']) {
      expect(isWallTypingKey(key)).toBe(false)
      expect(isWallTypingKey(key, '5')).toBe(false)
    }
  })
})

describe('shouldArmFloorplanSpacePan', () => {
  const openFloorplan = {
    defaultPrevented: false,
    isFloorplanOpen: true,
    isWallBuildActive: true,
    hasDraftStart: true,
    typingBuffer: '',
  }

  test('arms pan when the floorplan is open and the length buffer is empty', () => {
    expect(shouldArmFloorplanSpacePan(openFloorplan)).toBe(true)
  })

  test('skips pan when 3D typing already owned the key', () => {
    expect(shouldArmFloorplanSpacePan({ ...openFloorplan, defaultPrevented: true })).toBe(false)
  })

  test('skips pan while a wall draft is mid typed-length entry', () => {
    expect(shouldArmFloorplanSpacePan({ ...openFloorplan, typingBuffer: "5'" })).toBe(false)
  })

  test('still pans on an open wall draft when the buffer is empty', () => {
    expect(
      shouldArmFloorplanSpacePan({
        ...openFloorplan,
        isWallBuildActive: true,
        hasDraftStart: true,
        typingBuffer: '',
      }),
    ).toBe(true)
  })

  test('does not pan when the floorplan is closed', () => {
    expect(shouldArmFloorplanSpacePan({ ...openFloorplan, isFloorplanOpen: false })).toBe(false)
  })
})
