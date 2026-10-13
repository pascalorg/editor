import { useScene } from '@pascal-app/core'
import { mergeWindows, wrapCorner } from '@pascal-app/core/building'
import { writeWindowChanges } from '@pascal-app/editor'

/**
 * The window just placed or dropped at a corner joins the corner window: with the window waiting
 * on the other wall (`waitingId`) it becomes one corner pair, the waiting window's height, sill and
 * type kept; with none waiting, a partner is created on the other wall. A refusal leaves the window
 * where it stands, plain.
 */
export function fuseAtCorner(windowId: string, waitingId: string | null) {
  try {
    if (waitingId) {
      const merge = mergeWindows(useScene.getState().nodes, waitingId, windowId)
      writeWindowChanges({
        create: null,
        updates: Object.fromEntries(merge.changes.update.map(({ id, data }) => [id, data])),
        remove: merge.changes.delete,
      })
      return
    }
    const { create, updates } = wrapCorner(useScene.getState().nodes, windowId)
    writeWindowChanges({ create, updates, remove: [] })
  } catch {
    // The window stays a plain window at the corner.
  }
}
