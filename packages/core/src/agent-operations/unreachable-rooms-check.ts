import { circulationDiagnostics } from './reachability'
import type { SceneNodes } from './types'
import { registerSceneCheck } from './verify-scene'

export type RoomUnreachableIssue = {
  type: 'room_unreachable'
  message: string
  severity: 'warning'
  nodeIds: string[]
  levelIds: string[]
  spaceId?: string
}

/**
 * A room no walk from outside reaches through the doors, openings, open edges, stairs and lifts the
 * scene models. A level no entrance reaches is one fact about the level, said by the storey checks;
 * a room whose route crosses geometry the reading cannot measure is not named (its access is unknown,
 * not missing).
 */
export function unreachableRoomIssues(nodes: SceneNodes): RoomUnreachableIssue[] {
  return circulationDiagnostics(nodes).flatMap((reading): RoomUnreachableIssue[] =>
    reading.type === 'room_unreachable'
      ? [
          {
            type: 'room_unreachable',
            message: reading.message,
            severity: 'warning',
            nodeIds: reading.nodeIds,
            levelIds: reading.levelIds ?? [],
            ...(reading.spaceId ? { spaceId: reading.spaceId } : {}),
          },
        ]
      : [],
  )
}

registerSceneCheck({
  name: 'unreachable rooms',
  order: 80,
  run: (nodes) => {
    try {
      return unreachableRoomIssues(nodes)
    } catch {
      // A scene the circulation graph cannot walk is the schema check's to report.
      return []
    }
  },
})
