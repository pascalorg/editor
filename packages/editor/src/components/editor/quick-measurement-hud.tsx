'use client'

import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../store/use-editor'
import {
  selectQuickMeasurementHudEntry,
  useQuickMeasurementHud,
} from '../../store/use-quick-measurement-hud'
import { QuickMeasurementCard } from './quick-measurement-card'

export function QuickMeasurementHud() {
  const viewMode = useEditor((state) => state.viewMode)
  const entry = useQuickMeasurementHud((state) => selectQuickMeasurementHudEntry(state, viewMode))
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)

  if (!entry) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-3 top-3 z-40 flex justify-center"
      data-quick-measure-hud
    >
      <div className="w-full max-w-[34rem]">
        <QuickMeasurementCard
          lensState={entry.lensState}
          metricNotation={metricNotation}
          report={entry.report}
          unit={unit}
        />
      </div>
    </div>
  )
}
