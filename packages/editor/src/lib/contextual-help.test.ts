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
        keys: [['Cmd/Ctrl', 'Shift'], 'Left click'],
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
      keys: ['Left click'],
      label: 'Drag selected movable object',
    })
    expect(hints).toContainEqual({
      keys: ['Cmd/Ctrl', 'Right click'],
      label: 'Drag left or right to rotate selected object',
    })
    // Cmd/Ctrl and Shift click both toggle selection membership (3D selection
    // manager and 2D floorplan alike) — advertised as a single or-group row.
    expect(hints).toContainEqual({
      keys: [['Cmd/Ctrl', 'Shift'], 'Left click'],
      label: 'Add or remove objects from the selection',
      active: false,
    })
  })

  test('multi-selection advertises the group move + rotate gestures', () => {
    const hints = resolveSelectModeHelpHints({
      selectedCount: 3,
      hasMovableSelection: true,
      hasRotatableSelection: true,
      commandPressed: false,
      shiftPressed: false,
    })

    expect(hints).toEqual([
      {
        keys: ['Left click'],
        label: 'Click or drag the selection to move it as one',
      },
      { keys: ['R / T'], label: 'Rotate the selection ±45°' },
      {
        keys: [['Cmd/Ctrl', 'Shift'], 'Left click'],
        label: 'Add or remove objects from the selection',
        active: false,
      },
      { keys: ['Esc'], label: 'Clear the selection (or click outside)' },
    ])
  })

  test('holding a modifier keeps the same rows and only lights the selection one', () => {
    // Guides/snapping are governed by the snapping mode (Shift toggles it),
    // so no modifier-specific "freely / with guides / bypass" variants exist.
    const hints = resolveSelectModeHelpHints({
      selectedCount: 1,
      hasMovableSelection: true,
      hasRotatableSelection: true,
      commandPressed: true,
      shiftPressed: true,
    })

    expect(hints).toEqual([
      {
        keys: ['Left click'],
        label: 'Drag selected movable object',
      },
      {
        keys: ['Cmd/Ctrl', 'Right click'],
        label: 'Drag left or right to rotate selected object',
      },
      {
        keys: [['Cmd/Ctrl', 'Shift'], 'Left click'],
        label: 'Add or remove objects from the selection',
        active: true,
      },
    ])
  })
})
