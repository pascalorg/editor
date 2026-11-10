import type { ParseMeasurementOptions } from '../../lib/measurement-parser'
import { isTypingTarget } from '../../lib/typing-target'
import useEditor from '../../store/use-editor'
import {
  PLACEMENT_TYPING_LENGTH_ANGLE,
  routePlacementTypingKey,
  usePlacementTyping,
} from '../../store/use-placement-typing'
import { visibleScene } from '../../store/view-layout'
import { getSegmentGridStep, type WallPlanPoint } from '../tools/wall/wall-drafting'
import { resolveTypedWallEnd } from '../tools/wall/wall-typed-entry'

export type FloorplanWallTypingDraft = {
  start: WallPlanPoint
  /** The plan-snapped pointer the typed fields re-project. */
  pointer: WallPlanPoint
  lengthOptions: ParseMeasurementOptions
}

/**
 * Typed entry for the plan's own wall draft (2D-only view; in split view the
 * 3D wall tool drafts and owns these keys). A window capture listener, so it
 * runs before the global shortcuts and a typed `1`, `m` or the session's
 * Escape never reaches them.
 */
export function installFloorplanWallTypingKeys({
  getDraft,
  commit,
}: {
  getDraft: () => FloorplanWallTypingDraft | null
  commit: (pointer: WallPlanPoint) => void
}): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return
    if (visibleScene(useEditor.getState()) !== '2d') return
    const draft = getDraft()
    if (!draft) return
    const outcome = routePlacementTypingKey(event, {
      begin: (activeField) => {
        usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE, activeField })
        return true
      },
      tabBegins: true,
    })
    if (!outcome) return
    event.preventDefault()
    event.stopPropagation()
    if (outcome !== 'commit') return
    const typedEnd = resolveTypedWallEnd(
      draft.start,
      draft.pointer,
      usePlacementTyping.getState().fields,
      draft.lengthOptions,
      getSegmentGridStep(),
    )
    if (typedEnd) commit(draft.pointer)
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
