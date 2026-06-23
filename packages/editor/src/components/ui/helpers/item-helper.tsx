import { ContextualHelperPanel } from './contextual-helper-panel'

interface ItemHelperProps {
  showEsc?: boolean
}

export function ItemHelper({ showEsc }: ItemHelperProps) {
  return (
    <ContextualHelperPanel
      showSnapping
      hints={[
        { keys: ['Left click'], label: 'Place item' },
        { keys: ['R'], label: 'Rotate counterclockwise' },
        { keys: ['T'], label: 'Rotate clockwise' },
        { keys: ['Shift'], label: 'Cycle snapping mode' },
        { keys: ['Alt'], label: 'Free place (no snap)' },
        { keys: [showEsc ? 'Esc' : 'Right click'], label: 'Cancel' },
      ]}
    />
  )
}
