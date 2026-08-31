import type { ToolHint } from '@pascal-app/core'
import { useTranslations } from '../../../lib/i18n'
import type { SnapContext } from '../../../lib/snapping-mode'
import useEditor from '../../../store/use-editor'
import useRoofPlacementMode from '../../tools/roof/roof-placement-mode'
import { ContextualHelperPanel } from './contextual-helper-panel'

const placementHint: ToolHint = {
  key: 'P',
  label: 'Placement',
  chip: {
    subscribe: (onChange) => useRoofPlacementMode.subscribe(onChange),
    value: () => useRoofPlacementMode.getState().mode,
    cycle: () => useRoofPlacementMode.getState().cycleMode(),
    labels: {
      auto: 'Placement: Auto',
      ground: 'Placement: Ground',
      roof: 'Placement: Roof',
    },
    icons: {
      auto: 'lucide:scan-search',
      ground: 'lucide:land-plot',
      roof: 'lucide:house',
    },
    tooltip: 'Placement surface - click or press P to cycle',
  },
}

export function RoofHelper({ snapContext }: { snapContext?: SnapContext | null }) {
  const t = useTranslations()
  const isConical = useEditor((state) => state.toolDefaults.roof?.roofType === 'conical')
  const footprintSource = useEditor((state) => state.toolDefaults.roof?.footprintSource)
  const placementLabel =
    footprintSource === 'room'
      ? t('editor.chooseRoom')
      : footprintSource === 'walls'
        ? t('editor.selectCurvedWall')
        : isConical
          ? t('editor.setDiameter')
          : t('editor.setCorner')
  return (
    <ContextualHelperPanel
      chipHints={isConical ? [placementHint] : []}
      hints={[
        {
          keys: ['Left click'],
          label: placementLabel,
        },
        ...(!isConical
          ? [{ keys: ['R'], label: t('editor.rotateRoofDirection') }]
          : []),
        { keys: ['Esc'], label: t('common.cancel') },
      ]}
      snapContext={snapContext}
    />
  )
}