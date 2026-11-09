import { mergeWindows } from '../building/merge-windows'
import { achievedChanges } from './achieved'
import type { AgentOperation, SceneChanges } from './types'

const round = (value: number) => Math.round(value * 1000) / 1000

/** `merge_windows`: two windows that exist become one, a corner window or one wide window. */
export const mergeWindowsOperation: AgentOperation<{ windowIds: [string, string] }> = (
  nodes,
  input,
) => {
  const merge = mergeWindows(nodes, input.windowIds[0], input.windowIds[1])
  const changes: SceneChanges = {
    update: merge.changes.update.map(({ id, data }) => ({ id, data: data as never })),
    delete: merge.changes.delete,
  }
  return {
    changes,
    result: {
      ok: true,
      kind: merge.kind === 'corner' ? 'corner' : 'same_wall',
      windowIds: merge.windowIds,
      removedIds: merge.removedIds,
      wallIds: merge.wallIds,
      sillHeight: round(merge.sillHeight),
      height: round(merge.height),
      ...(merge.width === undefined ? {} : { width: round(merge.width) }),
      ...(merge.angle === undefined ? {} : { angle: merge.angle }),
      message: merge.message,
      achieved: achievedChanges(nodes, changes),
    },
  }
}
