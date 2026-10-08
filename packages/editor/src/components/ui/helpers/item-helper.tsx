import type { ContinuationContext } from '../../../lib/continuation'
import type { HudTitle } from '../../../lib/hud-title'
import type { SnapContext } from '../../../lib/snapping-mode'
import { ContextualHelperPanel } from './contextual-helper-panel'

interface ItemHelperProps {
  showEsc?: boolean
  snapContext?: SnapContext | null
  // Whether to advertise Alt = force-place. Only meaningful for kinds that
  // collision-validate their drop.
  showForce?: boolean
  // Set for a fresh point-kind placement (e.g. a positioned preset) so the
  // once/repeat continuation chip shows; null for an existing-node move.
  continuationContext?: ContinuationContext | null
  title?: HudTitle | null
  // Why the item would not fit where it is (a door's way, a room too small): a warning, not a block.
  notice?: string | null
}

// Snapping mode is the chip on the right (Shift cycles it), so it's not repeated
// as a key hint. Rotate is the two keys; Alt forces an invalid (red) drop.
export function ItemHelper({
  showEsc,
  snapContext,
  showForce,
  continuationContext = null,
  title = null,
  notice = null,
}: ItemHelperProps) {
  return (
    <ContextualHelperPanel
      continuationContext={continuationContext}
      notice={notice}
      hints={[
        { keys: ['Left click'], label: 'Place' },
        { keys: ['R', 'T'], label: 'Rotate' },
        ...(showForce ? [{ keys: ['Alt'], label: 'Force place' }] : []),
        { keys: [showEsc ? 'Esc' : 'Right click'], label: 'Cancel' },
      ]}
      snapContext={snapContext}
      title={title}
    />
  )
}
