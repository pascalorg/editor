import { beforeEach, describe, expect, test } from 'bun:test'
import {
  isPlacementTypingKey,
  PLACEMENT_TYPING_DISTANCE_OFFSET,
  PLACEMENT_TYPING_LENGTH_ANGLE,
  routePlacementTypingKey,
  usePlacementTyping,
} from './use-placement-typing'

const key = (
  k: string,
  mods: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>> = {},
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
})

const beginTwoFields = (activeField: 0 | 1) => {
  usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_DISTANCE_OFFSET, activeField })
  return true
}

describe('usePlacementTyping', () => {
  beforeEach(() => {
    usePlacementTyping.getState().clear()
  })

  test('keeps two independent field buffers and toggles the active field', () => {
    const typing = usePlacementTyping.getState()
    typing.begin({ labels: PLACEMENT_TYPING_DISTANCE_OFFSET, fieldDefaults: ['1.2', '0'] })
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
    typing.begin({ labels: PLACEMENT_TYPING_DISTANCE_OFFSET })
    typing.append('25')
    typing.toggleField()
    typing.append('3')
    typing.backspace()

    expect(usePlacementTyping.getState().fields).toEqual(['25', ''])
  })

  test('publishes projection and an enter request without clearing input', () => {
    const typing = usePlacementTyping.getState()
    typing.begin({ labels: PLACEMENT_TYPING_DISTANCE_OFFSET })
    typing.append('2')
    typing.setProjectedPosition([2, 0, 1])
    typing.requestCommit()

    expect(usePlacementTyping.getState().projectedPosition).toEqual([2, 0, 1])
    expect(usePlacementTyping.getState().submitRevision).toBe(1)
    expect(usePlacementTyping.getState().isActive).toBe(true)
  })

  test('clear ends the session and forgets its labels', () => {
    usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE })
    usePlacementTyping.getState().append('3')
    usePlacementTyping.getState().clear()
    const state = usePlacementTyping.getState()
    expect(state.isActive).toBe(false)
    expect(state.fields).toEqual(['', ''])
    expect(state.labels).toEqual([])
  })
})

describe('routePlacementTypingKey', () => {
  beforeEach(() => {
    usePlacementTyping.getState().clear()
  })

  test('a digit or a leading dot opens a session on the first field', () => {
    expect(routePlacementTypingKey(key('5'), { begin: beginTwoFields })).toBe('edit')
    expect(usePlacementTyping.getState().fields).toEqual(['5', ''])
    usePlacementTyping.getState().clear()
    expect(routePlacementTypingKey(key('.'), { begin: beginTwoFields })).toBe('edit')
    expect(usePlacementTyping.getState().fields).toEqual(['.', ''])
  })

  test('letters, signs and separators leave tool shortcuts alone until a session opens', () => {
    for (const k of ['c', 'm', 't', 'f', '-', ' ', ',']) {
      expect(routePlacementTypingKey(key(k), { begin: beginTwoFields })).toBeNull()
    }
    expect(usePlacementTyping.getState().isActive).toBe(false)
  })

  test('no session opens when the tool refuses or offers no begin', () => {
    expect(routePlacementTypingKey(key('5'), { begin: () => false })).toBeNull()
    expect(routePlacementTypingKey(key('5'))).toBeNull()
    expect(usePlacementTyping.getState().isActive).toBe(false)
  })

  test('Tab opens a session on the second field only when the tool asks for it', () => {
    expect(routePlacementTypingKey(key('Tab'), { begin: beginTwoFields })).toBeNull()
    expect(routePlacementTypingKey(key('Tab'), { begin: beginTwoFields, tabBegins: true })).toBe(
      'edit',
    )
    expect(usePlacementTyping.getState().activeField).toBe(1)
  })

  test('inside a session: unit letters extend, Tab and comma switch, Enter commits', () => {
    routePlacementTypingKey(key('1'), { begin: beginTwoFields })
    for (const k of ['8', '0', 'c', 'm']) routePlacementTypingKey(key(k))
    expect(routePlacementTypingKey(key('Tab'))).toBe('edit')
    routePlacementTypingKey(key('-'))
    routePlacementTypingKey(key('2'))
    expect(routePlacementTypingKey(key(','))).toBe('edit')
    expect(usePlacementTyping.getState().fields).toEqual(['180cm', '-2'])
    expect(usePlacementTyping.getState().activeField).toBe(0)
    expect(routePlacementTypingKey(key('Enter'))).toBe('commit')
    expect(usePlacementTyping.getState().isActive).toBe(true)
  })

  test('Backspace edits, Delete empties the active field', () => {
    routePlacementTypingKey(key('4'), { begin: beginTwoFields })
    routePlacementTypingKey(key('2'))
    routePlacementTypingKey(key('Backspace'))
    expect(usePlacementTyping.getState().fields[0]).toBe('4')
    routePlacementTypingKey(key('Delete'))
    expect(usePlacementTyping.getState().fields[0]).toBe('')
    expect(usePlacementTyping.getState().isActive).toBe(true)
  })

  test('the first Escape only ends the session', () => {
    routePlacementTypingKey(key('3'), { begin: beginTwoFields })
    expect(routePlacementTypingKey(key('Escape'))).toBe('clear')
    expect(usePlacementTyping.getState().isActive).toBe(false)
    expect(routePlacementTypingKey(key('Escape'))).toBeNull()
  })

  test('chords are never consumed', () => {
    expect(
      routePlacementTypingKey(key('5', { metaKey: true }), { begin: beginTwoFields }),
    ).toBeNull()
    routePlacementTypingKey(key('5'), { begin: beginTwoFields })
    expect(routePlacementTypingKey(key('z', { ctrlKey: true }))).toBeNull()
    expect(routePlacementTypingKey(key('Enter', { altKey: true }))).toBeNull()
    expect(usePlacementTyping.getState().fields[0]).toBe('5')
  })
})

describe('isPlacementTypingKey', () => {
  test('accepts the measurement grammar', () => {
    for (const k of ['0', '9', 'm', 'c', '.', "'", '"', '-', '+', ' ', '/']) {
      expect(isPlacementTypingKey(k)).toBe(true)
    }
  })

  test('rejects control keys and the field separator', () => {
    for (const k of ['Enter', 'Escape', 'Tab', 'Shift', '', 'F1', ',']) {
      expect(isPlacementTypingKey(k)).toBe(false)
    }
  })
})
