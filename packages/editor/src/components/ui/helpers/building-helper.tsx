import { ContextualHelperPanel } from './contextual-helper-panel'

interface BuildingHelperProps {
  showRotate?: boolean
}

// Rotate is one hint with both keys (R / T) — never two separate
// counterclockwise / clockwise rows — to match every other placement helper.
export function BuildingHelper({ showRotate }: BuildingHelperProps) {
  return (
    <ContextualHelperPanel
      hints={[
        { keys: ['Left click'], label: 'Place building' },
        ...(showRotate ? [{ keys: ['R', 'T'], label: 'Rotate' }] : []),
        { keys: ['Esc'], label: 'Cancel' },
      ]}
    />
  )
}
