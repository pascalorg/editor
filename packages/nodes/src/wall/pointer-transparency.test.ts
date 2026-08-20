import { describe, expect, test } from 'bun:test'
import { hiddenWallPointerEventsHeld, holdHiddenWallPointerEvents } from '@pascal-app/core'
import { wallPointerEventsSuppressed } from './pointer-transparency'

// Semantics pinned here (the wall renderer's gated handlers evaluate this
// predicate per pointer event):
// - #683 / night-5 D4: a wall hidden by the wall-mode pass swallows NO
//   pointer events, so clicks reach the visible device / service boxes
//   behind its invisible collision mesh.
// - night-6 door-drag: while a door / window move / place tool holds
//   hidden-wall pointer events, hidden walls DO keep raycasting — the tools
//   track the cursor through wall:enter / wall:move / wall:click, and
//   without the wall the opening free-follows the floor as a detached red
//   world-axis ghost instead of sliding along its wall.
// - delete mode keeps events regardless (deleteInvisible hover flow).
// - visible walls never suppress.

describe('wallPointerEventsSuppressed', () => {
  const base = {
    wallHidden: true,
    hoverHighlightMode: 'default' as string | null | undefined,
    hiddenWallHoldActive: false,
  }

  test('hidden wall, no tool: pointer-transparent (the D4 outlet fix)', () => {
    expect(wallPointerEventsSuppressed(base)).toBe(true)
  })

  test('hidden wall, opening tool hold: events flow (door/window drags slide)', () => {
    expect(wallPointerEventsSuppressed({ ...base, hiddenWallHoldActive: true })).toBe(false)
  })

  test('hidden wall, delete mode: events flow (deleteInvisible hover)', () => {
    expect(wallPointerEventsSuppressed({ ...base, hoverHighlightMode: 'delete' })).toBe(false)
  })

  test('visible wall: never suppressed, in any mode', () => {
    for (const hoverHighlightMode of ['default', 'delete', null, undefined]) {
      for (const hiddenWallHoldActive of [false, true]) {
        expect(
          wallPointerEventsSuppressed({
            wallHidden: false,
            hoverHighlightMode,
            hiddenWallHoldActive,
          }),
        ).toBe(false)
      }
    }
  })

  test('composes with the real core hold lifecycle', () => {
    const suppressedNow = () =>
      wallPointerEventsSuppressed({ ...base, hiddenWallHoldActive: hiddenWallPointerEventsHeld() })
    expect(suppressedNow()).toBe(true)
    const release = holdHiddenWallPointerEvents()
    expect(suppressedNow()).toBe(false)
    release()
    expect(suppressedNow()).toBe(true)
  })
})
