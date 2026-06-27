import type { ContinuationContext } from '../../../lib/continuation'
import type { SnapContext } from '../../../lib/snapping-mode'
import { ContextualHelperPanel } from './contextual-helper-panel'

interface ItemHelperProps {
  showEsc?: boolean
  snapContext?: SnapContext | null
  // Whether to advertise Alt = force-place. Only meaningful for kinds that
  // collision-validate their drop (structural kinds never reject, so it's hidden).
  showForce?: boolean
  // Set for a fresh point-kind placement (e.g. a positioned preset) so the
  // once/repeat continuation chip shows; null for an existing-node move.
  continuationContext?: ContinuationContext | null
}

// Snapping mode is the chip on the right (Shift cycles it), so it's not repeated
// as a key hint. Rotate is the two keys; Alt forces an invalid (red) drop.
export function ItemHelper({
  showEsc,
  snapContext,
  showForce,
  continuationContext = null,
}: ItemHelperProps) {
  return (
    <ContextualHelperPanel
      continuationContext={continuationContext}
      hints={[
        { keys: ['Left click'], label: 'Place' },
        { keys: ['R', 'T'], label: 'Rotate' },
        ...(showForce ? [{ keys: ['Alt'], label: 'Force place' }] : []),
        { keys: [showEsc ? 'Esc' : 'Right click'], label: 'Cancel' },
      ]}
      snapContext={snapContext}
    />
  )
}
