import { describe, expect, test } from 'bun:test'
import { shouldCloseOnEscape } from './overlay'

/**
 * A stand-in document. `open` is the list of selectors that currently match
 * something on the page; `activeElement` is whatever has focus.
 */
function doc(open: string[] = [], activeElement: unknown = null) {
  return {
    querySelector: (selector: string) =>
      selector.split(', ').some((one) => open.includes(one)) ? {} : null,
    activeElement,
  }
}

describe('Escape only closes the workspace when nothing else is open', () => {
  test('closes on a bare sheet with nothing focused', () => {
    expect(shouldCloseOnEscape(doc())).toBe(true)
  })

  test('a nested dialog keeps it open', () => {
    expect(shouldCloseOnEscape(doc(['[role="dialog"]']))).toBe(false)
    expect(shouldCloseOnEscape(doc(['[role="alertdialog"]']))).toBe(false)
  })

  test('a menu, listbox or popover keeps it open', () => {
    expect(shouldCloseOnEscape(doc(['[role="menu"]']))).toBe(false)
    expect(shouldCloseOnEscape(doc(['[role="listbox"]']))).toBe(false)
    expect(shouldCloseOnEscape(doc(['[data-radix-popper-content-wrapper]']))).toBe(false)
  })

  test('the command palette keeps it open', () => {
    expect(shouldCloseOnEscape(doc(['[cmdk-root]']))).toBe(false)
  })

  test("the rail's own “+ Viewport” list keeps it open", () => {
    expect(shouldCloseOnEscape(doc(['[data-sheets-menu]']))).toBe(false)
  })

  test('a focused text field keeps it open', () => {
    expect(shouldCloseOnEscape(doc([], { tagName: 'INPUT' }))).toBe(false)
    expect(shouldCloseOnEscape(doc([], { tagName: 'TEXTAREA' }))).toBe(false)
    expect(shouldCloseOnEscape(doc([], { tagName: 'SELECT' }))).toBe(false)
    expect(shouldCloseOnEscape(doc([], { tagName: 'DIV', isContentEditable: true }))).toBe(false)
  })

  test('a focused button does not', () => {
    expect(shouldCloseOnEscape(doc([], { tagName: 'BUTTON' }))).toBe(true)
    expect(shouldCloseOnEscape(doc([], { tagName: 'BODY' }))).toBe(true)
  })
})
