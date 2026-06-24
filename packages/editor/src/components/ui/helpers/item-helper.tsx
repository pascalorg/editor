import type { SnapContext } from '../../../lib/snapping-mode'
import { ContextualHelperPanel } from './contextual-helper-panel'

interface ItemHelperProps {
  showEsc?: boolean
  snapContext?: SnapContext | null
  // Whether to advertise Alt = force-place. Only meaningful for kinds that
  // collision-validate their drop (structural kinds never reject, so it's hidden).
  showForce?: boolean
}

// Snapping mode is the chip on the right (Shift cycles it), so it's not repeated
// as a key hint. Rotate is the two keys; Alt forces an invalid (red) drop.
export function ItemHelper({ showEsc, snapContext, showForce }: ItemHelperProps) {
  return (
    <ContextualHelperPanel
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
