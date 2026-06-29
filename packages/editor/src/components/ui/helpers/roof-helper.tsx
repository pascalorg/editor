import type { SnapContext } from '../../../lib/snapping-mode'
import { ContextualHelperPanel } from './contextual-helper-panel'

export function RoofHelper({ snapContext }: { snapContext?: SnapContext | null }) {
  return (
    <ContextualHelperPanel
      hints={[
        { keys: ['Left click'], label: 'Set corner' },
        { keys: ['Esc'], label: 'Cancel' },
      ]}
      snapContext={snapContext}
    />
  )
}
