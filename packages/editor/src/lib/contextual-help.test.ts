import { describe, expect, test } from 'bun:test'
import { resolveSelectModeHelpHints } from './contextual-help'

describe('resolveSelectModeHelpHints', () => {
  test('stays hidden in idle select mode with no selection', () => {
    expect(
      resolveSelectModeHelpHints({
        selectedCount: 0,
        hasMovableSelection: false,
        hasRotatableSelection: false,
        commandPressed: false,
        shiftPressed: false,
      }),
    ).toEqual([])
  })

  test('shows multi-select guidance when a modifier is held without selection', () => {
    expect(
      resolveSelectModeHelpHints({
        selectedCount: 0,
        hasMovableSelection: false,
        hasRotatableSelection: false,
        commandPressed: true,
        shiftPressed: false,
      }),
    ).toEqual([
      {
        keys: ['Cmd/Ctrl', 'Left click'],
        label: 'Add or remove objects from the selection',
        active: true,
      },
    ])
  })

  test('shows direct manipulation tips for selected movable and rotatable nodes', () => {
    const hints = resolveSelectModeHelpHints({
      selectedCount: 1,
      hasMovableSelection: true,
      hasRotatableSelection: true,
      commandPressed: false,
      shiftPressed: false,
    })

    expect(hints).toContainEqual({
      keys: ['Cmd/Ctrl', 'Left click'],
      label: 'Drag selected movable object',
    })
    expect(hints).toContainEqual({
      keys: ['Cmd/Ctrl', 'Right click'],
      label: 'Drag left or right to rotate selected object',
    })
    // The Shift bypass hint is gated to the in-progress direct-move gesture
    // (Cmd/Ctrl held); on an idle selection it must not appear (Shift there
    // means multi-select, not bypass).
    expect(hints).not.toContainEqual({
      keys: ['Shift'],
      label: 'Hold to bypass snaps and angle steps',
      active: false,
    })
  })

  test('switches direct manipulation labels while constraints are bypassed', () => {
    const hints = resolveSelectModeHelpHints({
      selectedCount: 1,
      hasMovableSelection: true,
      hasRotatableSelection: true,
      commandPressed: true,
      shiftPressed: true,
    })

    expect(hints).toContainEqual({
      keys: ['Cmd/Ctrl', 'Left click'],
      label: 'Drag selected movable object freely',
      active: true,
    })
    expect(hints).toContainEqual({
      keys: ['Cmd/Ctrl', 'Right click'],
      label: 'Drag left or right to rotate freely',
      active: true,
    })
    expect(hints).toContainEqual({
      keys: ['Shift'],
      label: 'Guided constraints bypassed',
      active: true,
    })
  })
})
