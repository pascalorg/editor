import { usePascalI18n } from '@pascal-app/core'
import type { ToolHint } from '@pascal-app/core'
import type { ContinuationContext } from '../../../lib/continuation'
import type { HudTitle } from '../../../lib/hud-title'
import type { SnapContext } from '../../../lib/snapping-mode'
import { useVisibleToolHints } from '../../../lib/panel-tool-options'
import { ContextualHelperPanel } from './contextual-helper-panel'

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
  title = null,
  notice = null,
}: {
  hints: ToolHint[]
  shiftPressed?: boolean
  snapContext?: SnapContext | null
  continuationContext?: ContinuationContext | null
  title?: HudTitle | null
  notice?: string | null
}) {
  const i18n = usePascalI18n()
  const visible = useVisibleToolHints(hints)
  if (visible.length === 0 && !snapContext && !continuationContext && !notice) return null
  // Hints carrying a live-state `chip` render as mode chips next to the
  // snapping / continuation rows; the rest stay static key rows.
  const chipHints = visible.filter((hint) => hint.chip)
  const staticHints = visible.filter((hint) => !hint.chip)
  return (
    <ContextualHelperPanel
      chipHints={chipHints}
      hints={staticHints.map((hint) => {
        // Shift is a per-kind bypass for opening / zone / duct placement ("Free
        // place", "Free angle", …) — those flip to a bypassed state while held.
        const isBypassHint = hint.key === 'Shift'
        return {
          keys: [hint.key],
          label: shiftPressed && isBypassHint ? i18n._({ id: 'editor.helpers.registeredToolHelper.guidedConstraintsBypassed', message: 'Guided constraints bypassed' }) : hint.label,
          // A hint that only appears once the draft can be finished ("Enter: Finish slab") is the
          // news of the moment: it is shown without unfolding the card, like the other live rows.
          active: (shiftPressed && isBypassHint) || hint.minDraftVertices != null,
        }
      })}
      continuationContext={continuationContext}
      notice={notice}
      snapContext={snapContext}
      title={title}
    />
  )
}
