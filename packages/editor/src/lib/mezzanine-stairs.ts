import {
  type AnyNodeId,
  planMezzanineStair,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { MEZZANINE_NO_STAIR_MESSAGE, mezzanineConflictMessage } from './mezzanine-messages'
import { applyRoomPlan } from './room-structure-commands'
import { sfxEmitter } from './sfx-bus'

export type MezzanineStairResult = { ok: true; stairId: string } | { ok: false; message: string }

/**
 * "Add stairs": core places a straight flight from the host floor up to one of
 * the mezzanine's open edges (its railing opens there), as one undo step. The
 * new stair is selected, like a new mezzanine is, so it can be adjusted at once.
 */
export function addMezzanineStairs(zoneId: string): MezzanineStairResult {
  const nodes = useScene.getState().nodes
  if (useScene.getState().readOnly || !nodes[zoneId as AnyNodeId])
    return { ok: false, message: MEZZANINE_NO_STAIR_MESSAGE }
  let plan: ReturnType<typeof planMezzanineStair>
  try {
    plan = planMezzanineStair(nodes, zoneId)
  } catch {
    return { ok: false, message: MEZZANINE_NO_STAIR_MESSAGE }
  }
  const conflict = plan.conflicts?.[0]
  if (conflict || !plan.stairId)
    return {
      ok: false,
      message: mezzanineConflictMessage(conflict?.code) ?? MEZZANINE_NO_STAIR_MESSAGE,
    }
  // The stair and its flight land as one step.
  let applied = false
  runAsSingleSceneHistoryStep(useScene, () => {
    applied = applyRoomPlan(plan)
  })
  if (!applied) return { ok: false, message: MEZZANINE_NO_STAIR_MESSAGE }
  sfxEmitter.emit('sfx:structure-build')
  useEditor.getState().clearRoom()
  useViewer.getState().setSelection({ selectedIds: [plan.stairId as AnyNodeId] })
  return { ok: true, stairId: plan.stairId! }
}
