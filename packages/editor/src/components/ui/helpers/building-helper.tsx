import { usePascalI18n } from '@pascal-app/core'
import type { HudTitle } from '../../../lib/hud-title'
import { ContextualHelperPanel } from './contextual-helper-panel'

interface BuildingHelperProps {
  showRotate?: boolean
  title?: HudTitle | null
}

// Rotate is one hint with both keys (R / T) — never two separate
// counterclockwise / clockwise rows — to match every other placement helper.
export function BuildingHelper({ showRotate, title = null }: BuildingHelperProps) {
  const i18n = usePascalI18n()
  return (
    <ContextualHelperPanel
      title={title}
      hints={[
        { keys: ['Left click'], label: i18n._({ id: 'editor.helpers.buildingHelper.placeBuilding', message: 'Place building' }) },
        ...(showRotate ? [{ keys: ['R', 'T'], label: i18n._({ id: 'editor.helpers.buildingHelper.rotate', message: 'Rotate' }) }] : []),
        { keys: ['Esc'], label: i18n._({ id: 'editor.helpers.buildingHelper.cancel', message: 'Cancel' }) },
      ]}
    />
  )
}
