import { describe, expect, test } from 'bun:test'
import { selectionModifiersFromEvent } from './selection-modifiers'

describe('selectionModifiersFromEvent', () => {
  test('falls back to tracked modifier state when the click event omits keys', () => {
    expect(
      selectionModifiersFromEvent({}, { meta: false, ctrl: true, shift: false, alt: false }),
    ).toEqual({
      meta: false,
      ctrl: true,
      shift: false,
      alt: false,
    })
  })

  test('prefers explicit event key state over stale tracked modifiers', () => {
    expect(
      selectionModifiersFromEvent(
        { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
        { meta: true, ctrl: true, shift: true, alt: true },
      ),
    ).toEqual({
      meta: false,
      ctrl: false,
      shift: false,
      alt: false,
    })
  })
})
