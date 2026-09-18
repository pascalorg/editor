'use client'

import { useTerrainPanelRows } from '../../../lib/terrain-panel-model'
import { PanelRows } from './panel-rows'

export function TerrainSculptPanel() {
  const rows = useTerrainPanelRows()
  return <PanelRows rows={rows} />
}
