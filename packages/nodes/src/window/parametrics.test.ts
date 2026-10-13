import { describe, expect, test } from 'bun:test'
import { WindowNode } from '@pascal-app/core'
import { windowParametrics } from './parametrics'

// One side of a corner window deleted left the other naming it: no jamb at the corner, and
// verify_scene asked the agent to rebuild the window the person had just removed.
describe('window deletion', () => {
  test("a corner window's side deleted leaves its partner a plain window", () => {
    const deleted = WindowNode.parse({
      id: 'window_deleted',
      corner: { end: 'end', partnerId: 'window_kept', post: 'none' },
    })
    const kept = WindowNode.parse({
      id: 'window_kept',
      corner: { end: 'start', partnerId: 'window_deleted', post: 'none' },
    })

    const updates = windowParametrics.onDelete?.(deleted, {
      [deleted.id]: deleted,
      [kept.id]: kept,
    })

    expect(updates).toContainEqual({ id: kept.id, data: { corner: undefined } })
  })

  test('a plain window deleted changes nothing else', () => {
    const plain = WindowNode.parse({ id: 'window_plain' })
    expect(windowParametrics.onDelete?.(plain, { [plain.id]: plain })).toEqual([])
  })
})
