import { ContextualHelperPanel } from './contextual-helper-panel'

interface ItemHelperProps {
  showEsc?: boolean
  shiftPressed?: boolean
}

export function ItemHelper({ showEsc, shiftPressed = false }: ItemHelperProps) {
  return (
    <ContextualHelperPanel
      hints={[
        { keys: ['Left click'], label: 'Place item' },
        { keys: ['R'], label: 'Rotate counterclockwise' },
        { keys: ['T'], label: 'Rotate clockwise' },
        {
          keys: ['Shift'],
          label: shiftPressed ? 'Guided constraints bypassed' : 'Free place',
          active: shiftPressed,
        },
        { keys: [showEsc ? 'Esc' : 'Right click'], label: 'Cancel' },
      ]}
    />
  )
}
