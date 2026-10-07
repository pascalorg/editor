import { afterEach, expect, test } from 'bun:test'
import { WindowNode } from '@pascal-app/core'
import {
  placedWindowFields,
  useWindowPlacement,
  WINDOW_PLACEMENT_HINTS,
  windowTakesStyle,
} from './placement'

const initial = useWindowPlacement.getState()
afterEach(() => useWindowPlacement.setState(initial))

// The window tool updates its draft by merging the chips' fields, so a type that writes no sill
// keeps whatever the previous type left: cycled past Bay or Bow, a Fixed window placed without one.
test("the window tool's type chip gives every type its own sill, cycled past Bay and Bow", () => {
  let draft = WindowNode.parse({ ...placedWindowFields() })
  const seen: Record<string, boolean> = {}
  for (let step = 0; step < 18; step++) {
    useWindowPlacement.getState().cycleType()
    draft = { ...draft, ...placedWindowFields() }
    seen[draft.windowType] = draft.sill
  }
  expect(seen).toEqual({
    fixed: true,
    sliding: true,
    casement: true,
    awning: true,
    'single-hung': true,
    'double-hung': true,
    bay: false,
    bow: false,
    louvered: true,
  })
})

// A style shapes a Fixed window's panes; every other type draws its own sashes and ignores them.
test('a style is offered only on a Fixed window: the panel row, the L chip and what is placed', () => {
  expect(windowTakesStyle('fixed')).toBe(true)
  for (const type of [
    'sliding',
    'casement',
    'awning',
    'single-hung',
    'double-hung',
    'bay',
    'bow',
    'louvered',
  ] as const)
    expect([type, windowTakesStyle(type)]).toEqual([type, false])

  const styleChip = WINDOW_PLACEMENT_HINTS.find((hint) => hint.key === 'L')!
  useWindowPlacement.setState({ type: 'fixed', style: 'grid' })
  expect(styleChip.visible?.value()).toBe(true)
  expect(placedWindowFields().columnRatios).toHaveLength(2)

  useWindowPlacement.getState().cycleType()
  expect(useWindowPlacement.getState().type).not.toBe('fixed')
  expect(styleChip.visible?.value()).toBe(false)
  expect(placedWindowFields()).not.toHaveProperty('columnRatios')
})
