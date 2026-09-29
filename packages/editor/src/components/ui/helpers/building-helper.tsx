import type { HudTitle } from '../../../lib/hud-title'
import { ContextualHelperPanel } from './contextual-helper-panel'

interface BuildingHelperProps {
  showRotate?: boolean
  title?: HudTitle | null
}

// Rotate is one hint with both keys (R / T) — never two separate
// counterclockwise / clockwise rows — to match every other placement helper.
export function BuildingHelper({ showRotate, title = null }: BuildingHelperProps) {
  return (
    <ContextualHelperPanel
      title={title}
      hints={[
        { keys: ['Left click'], label: 'Place building' },
        ...(showRotate ? [{ keys: ['R', 'T'], label: 'Rotate' }] : []),
        { keys: ['Esc'], label: 'Cancel' },
      ]}
    />
  )
}
