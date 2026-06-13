import { ContextualHelperPanel } from './contextual-helper-panel'

export function RoofHelper({ shiftPressed = false }: { shiftPressed?: boolean }) {
  return (
    <ContextualHelperPanel
      hints={[
        { keys: ['Left click'], label: 'Set corner' },
        {
          keys: ['Shift'],
          label: shiftPressed ? 'Guided constraints bypassed' : 'Free corner',
          active: shiftPressed,
        },
        { keys: ['Esc'], label: 'Cancel' },
      ]}
    />
  )
}
