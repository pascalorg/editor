import { useTranslations } from '../../../lib/i18n'
import { ContextualHelperPanel } from './contextual-helper-panel'

interface BuildingHelperProps {
  showRotate?: boolean
}

// Rotate is one hint with both keys (R / T) — never two separate
// counterclockwise / clockwise rows — to match every other placement helper.
export function BuildingHelper({ showRotate }: BuildingHelperProps) {
  const t = useTranslations()
  return (
    <ContextualHelperPanel
      hints={[
        { keys: ['Left click'], label: t('editor.placeBuilding') },
        ...(showRotate ? [{ keys: ['R', 'T'], label: t('editor.rotate') }] : []),
        { keys: ['Esc'], label: t('common.cancel') },
      ]}
    />
  )
}