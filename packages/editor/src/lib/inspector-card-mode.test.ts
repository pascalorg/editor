import { describe, expect, test } from 'bun:test'
import {
  type InspectorCardMode,
  resolveActiveExtension,
  toggleCard,
  toggleExtension,
} from './inspector-card-mode'

const collapsed: InspectorCardMode = { collapsed: true, activeExtensionId: null }
const regular: InspectorCardMode = { collapsed: false, activeExtensionId: null }
const engineering: InspectorCardMode = { collapsed: false, activeExtensionId: 'bones:eng' }

// EITHER/OR contract (replaces #667's appended-section behavior): the
// expanded card shows the regular controls OR one extension's content,
// never both. These gates encode every transition of the mode machine.

describe('toggleCard (chevron / header press)', () => {
  test('folded card expands to the REGULAR controls — no extension', () => {
    expect(toggleCard(collapsed)).toEqual(regular)
  })

  test('regular expanded card folds', () => {
    expect(toggleCard(regular)).toEqual(collapsed)
  })

  test('extension mode returns to the regular controls, staying expanded', () => {
    // The chevron exits extension mode first; it does NOT fold from there.
    expect(toggleCard(engineering)).toEqual(regular)
  })
})

describe('toggleExtension (header icon press)', () => {
  test('folded card opens straight into extension-only mode', () => {
    expect(toggleExtension(collapsed, 'bones:eng')).toEqual(engineering)
  })

  test('regular expanded card swaps to extension-only mode', () => {
    expect(toggleExtension(regular, 'bones:eng')).toEqual(engineering)
  })

  test('pressing the ACTIVE extension icon again returns to regular mode', () => {
    expect(toggleExtension(engineering, 'bones:eng')).toEqual(regular)
  })

  test('pressing another extension icon switches extension modes directly', () => {
    expect(toggleExtension(engineering, 'other:ext')).toEqual({
      collapsed: false,
      activeExtensionId: 'other:ext',
    })
  })
})

describe('resolveActiveExtension', () => {
  const bones = { id: 'bones:eng' }
  const other = { id: 'other:ext' }
  const extensions = [bones, other]

  test('null id → regular mode (no extension)', () => {
    expect(resolveActiveExtension(null, extensions)).toBeNull()
  })

  test('matching id → that extension fills the body', () => {
    expect(resolveActiveExtension('bones:eng', extensions)).toBe(bones)
    expect(resolveActiveExtension('other:ext', extensions)).toBe(other)
  })

  test('stale id (kind changed / plugin gated off) falls back to regular', () => {
    expect(resolveActiveExtension('bones:eng', [])).toBeNull()
    expect(resolveActiveExtension('gone:ext', extensions)).toBeNull()
  })
})

describe('full user flows (QA script)', () => {
  test('chevron → regular only; fold; icon → extension only; icon again → regular', () => {
    let mode = collapsed
    mode = toggleCard(mode) // chevron
    expect(mode).toEqual(regular)
    mode = toggleCard(mode) // fold
    expect(mode).toEqual(collapsed)
    mode = toggleExtension(mode, 'bones:eng') // bones icon
    expect(mode).toEqual(engineering)
    mode = toggleExtension(mode, 'bones:eng') // bones icon again
    expect(mode).toEqual(regular)
  })

  test('extension mode exits via the chevron too', () => {
    let mode = toggleExtension(collapsed, 'bones:eng')
    expect(mode).toEqual(engineering)
    mode = toggleCard(mode) // chevron
    expect(mode).toEqual(regular)
  })
})
