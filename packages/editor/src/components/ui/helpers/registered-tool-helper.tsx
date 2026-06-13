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
      hints={hints.map((hint) => ({
        keys: [hint.key],
        label:
          shiftPressed && hint.key === 'Shift' ? 'Guided constraints bypassed' : hint.label,
        active: shiftPressed && hint.key === 'Shift',
      }))}
    />
  )
}
