import { afterEach, expect, test } from 'bun:test'
import { WindowNode } from '@pascal-app/core'
import { placedWindowFields, useWindowPlacement } from './placement'

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
