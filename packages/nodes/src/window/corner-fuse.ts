import { type CornerSnap, useScene } from '@pascal-app/core'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { mergeWindows, strayCornerClears, wrapCorner } from '@pascal-app/core/building'
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
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
  }
}

/**
 * A window moved and dropped: joined at the corner it was dropped at, else, when it was one side of
 * a corner window and no longer is (dragged off its corner), both sides plain again.
 */
export function settleMovedWindow(windowId: string, snap: CornerSnap | null) {
  if (snap) {
    fuseAtCorner(windowId, snap.waitingId)
    return
  }
  const updates = strayCornerClears(useScene.getState().nodes, windowId)
  if (Object.keys(updates).length) writeWindowChanges({ create: null, updates, remove: [] })
}
