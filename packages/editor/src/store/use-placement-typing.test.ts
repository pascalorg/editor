import { beforeEach, describe, expect, test } from 'bun:test'
import { isPlacementTypingKey, usePlacementTyping } from './use-placement-typing'

describe('usePlacementTyping', () => {
  beforeEach(() => {
    usePlacementTyping.getState().clear()
  })

  test('keeps two independent field buffers and toggles the active field', () => {
    const typing = usePlacementTyping.getState()
    typing.begin(['1.2', '0'])
    typing.append('2')
    typing.toggleField()
    typing.append('-')
    typing.append('4')

    expect(usePlacementTyping.getState().fields).toEqual(['2', '-4'])
    expect(usePlacementTyping.getState().fieldDefaults).toEqual(['1.2', '0'])
    expect(usePlacementTyping.getState().activeField).toBe(1)
  })

  test('backspace only changes the active field', () => {
    const typing = usePlacementTyping.getState()
    typing.begin()
    typing.append('25')
    typing.toggleField()
    typing.append('3')
    typing.backspace()

    expect(usePlacementTyping.getState().fields).toEqual(['25', ''])
  })

  test('publishes projection and an enter request without clearing input', () => {
    const typing = usePlacementTyping.getState()
    typing.begin()
    typing.append('2')
    typing.setProjectedPosition([2, 0, 1])
    typing.requestCommit()

    expect(usePlacementTyping.getState().projectedPosition).toEqual([2, 0, 1])
    expect(usePlacementTyping.getState().submitRevision).toBe(1)
    expect(usePlacementTyping.getState().isActive).toBe(true)
  })
})

describe('isPlacementTypingKey', () => {
  test('accepts the cabinet measurement grammar', () => {
    for (const key of ['0', '9', 'm', 'c', '.', "'", '"', '-', ' ', '/', ',']) {
      expect(isPlacementTypingKey(key)).toBe(true)
    }
  })

  test('rejects control keys and modifiers', () => {
    for (const key of ['Enter', 'Escape', 'Tab', 'Shift', '', 'F1']) {
      expect(isPlacementTypingKey(key)).toBe(false)
    }
  })
})
