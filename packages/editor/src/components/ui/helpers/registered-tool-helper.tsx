import type { ToolHint } from '@pascal-app/core'
import { useMemo, useSyncExternalStore } from 'react'
import { isDrawingTool } from '../../../lib/drawing-controls'
import type { ContinuationContext } from '../../../lib/continuation'
import type { SnapContext } from '../../../lib/snapping-mode'
import useEditor from '../../../store/use-editor'
import { ContextualHelperPanel } from './contextual-helper-panel'
import { WallDraftLengthInput } from './wall-draft-length-input'

/**
 * Generic helper panel rendered from `def.toolHints` data. Matches the
 * visual styling of the hand-written `<WallHelper>` / `<ItemHelper>` /
 * etc. so registry-driven kinds get a consistent look without each kind
 * writing its own component.
 *
 * Drops the need for per-kind helper files entirely — kinds declare
 * their hints as static data in their `NodeDefinition`.
 */
export function RegisteredToolHelper({
  hints,
  shiftPressed = false,
  snapContext = null,
  continuationContext = null,
}: {
  hints: ToolHint[]
  shiftPressed?: boolean
  snapContext?: SnapContext | null
  continuationContext?: ContinuationContext | null
}) {
  const drawingTool = useEditor((s) =>
    s.mode === 'build' && isDrawingTool(s.tool) ? s.tool : null,
  )
  // Live vertex count of an in-progress polygon draft, so hints gated on a
  // minimum (e.g. "Finish" at ≥ 3) only appear once they're actually possible.
  const draftVertexCount = useEditor((s) => s.draftVertexCount)
  const isWallBuildActive = useEditor((s) => s.mode === 'build' && s.tool === 'wall')
  const visibilityStore = useMemo(
    () => ({
      subscribe: (onChange: () => void) => {
        const unsubscribers = hints.flatMap((hint) =>
          hint.visible ? [hint.visible.subscribe(onChange)] : [],
        )
        return () => {
          for (const unsubscribe of unsubscribers) unsubscribe()
        }
      },
      getSnapshot: () =>
        hints.map((hint) => (hint.visible?.value() === false ? '0' : '1')).join(''),
    }),
    [hints],
  )
  useSyncExternalStore(
    visibilityStore.subscribe,
    visibilityStore.getSnapshot,
    visibilityStore.getSnapshot,
  )
  // Some hints are replaced by live contextual chips, so keep the generic
  // registry renderer from duplicating stale/static versions.
  const visible = hints.filter(
    (hint) =>
      !(drawingTool && ['Enter', 'Backspace', 'Esc', 'Escape'].includes(hint.key)) &&
      !(hint.key === 'Shift' && hint.label === 'Cycle snapping mode') &&
      hint.visible?.value() !== false &&
      (hint.minDraftVertices == null || draftVertexCount >= hint.minDraftVertices),
  )
  if (visible.length === 0 && !snapContext && !continuationContext) return null
  // Hints carrying a live-state `chip` render as mode chips next to the
  // snapping / continuation rows; the rest stay static key rows.
  const chipHints = visible.filter((hint) => hint.chip)
  const staticHints = visible.filter((hint) => !hint.chip)
  if (drawingTool)
    staticHints.push(
      { key: 'Enter', label: 'Place / finish' },
      { key: 'Backspace', label: 'Remove last point' },
      { key: 'Esc', label: 'Cancel draft' },
    )
  return (
    <>
      {isWallBuildActive && <WallDraftLengthInput />}
      <ContextualHelperPanel
        chipHints={chipHints}
        hints={staticHints.map((hint) => {
          // Shift is a per-kind bypass for opening / zone / duct placement ("Free
          // place", "Free angle", …) — those flip to a bypassed state while held.
          const isBypassHint = hint.key === 'Shift'
          return {
            keys: [hint.key],
            label: shiftPressed && isBypassHint ? 'Guided constraints bypassed' : hint.label,
            active: shiftPressed && isBypassHint,
          }
        })}
        continuationContext={continuationContext}
        snapContext={snapContext}
      />
    </>
  )
}
