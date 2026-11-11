import { expect, test } from 'bun:test'
import { selectionCue } from './use-viewer-ui-sounds'

type Selection = Parameters<typeof selectionCue>[0]
const selection = (over: Partial<Record<keyof Selection, unknown>> = {}) =>
  ({ buildingId: null, levelId: 'level_a', zoneId: null, selectedIds: [], ...over }) as Selection

test('picking a room or an element selects; letting it go deselects', () => {
  expect(selectionCue(selection(), selection({ zoneId: 'zone_a' }))).toBe('viewerSelect')
  expect(
    selectionCue(selection({ zoneId: 'zone_a' }), selection({ selectedIds: ['door_a'] })),
  ).toBe('viewerSelect')
  expect(selectionCue(selection({ selectedIds: ['door_a'] }), selection())).toBe('viewerDeselect')
  expect(selectionCue(selection(), selection())).toBe(null)
})
