'use client'

import { useEditor } from '@pascal-app/editor'
import SmartMeasurementTool from './smart-tool'
import MeasurementTool from './tool'

export default function MeasurementToolRouter() {
  const kind = useEditor((state) => state.toolDefaults.measurement?.kind)
  return kind === 'smart' ? <SmartMeasurementTool /> : <MeasurementTool />
}
