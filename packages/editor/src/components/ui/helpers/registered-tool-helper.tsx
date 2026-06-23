import type { ToolHint } from '@pascal-app/core'
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
}: {
  hints: ToolHint[]
  shiftPressed?: boolean
}) {
  if (hints.length === 0) return null
  return (
    <ContextualHelperPanel
      showSnapping
      hints={hints.map((hint) => {
        // Shift is a per-kind bypass for item / opening / zone / duct placement
        // ("Free place", "Free angle", …) — those hints flip to a bypassed
        // state while held. For wall / fence, Shift now cycles the snapping
        // mode (no hold-to-bypass), so it must NOT show the bypass treatment.
        const isBypassHint = hint.key === 'Shift' && hint.label !== 'Cycle snapping mode'
        return {
          keys: [hint.key],
          label: shiftPressed && isBypassHint ? 'Guided constraints bypassed' : hint.label,
          active: shiftPressed && isBypassHint,
        }
      })}
    />
  )
}
