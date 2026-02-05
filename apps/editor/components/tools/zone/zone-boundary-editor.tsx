import { useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

/**
 * Zone boundary editor - allows editing zone polygon vertices when a zone is selected
 * Uses the generic PolygonEditor component
 */
export const ZoneBoundaryEditor: React.FC = () => {
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const zoneNode = useScene((state) => (selectedZoneId ? state.nodes[selectedZoneId] : null))
  const zone = zoneNode?.type === 'zone' ? (zoneNode as ZoneNode) : null
  const updateNode = useScene((state) => state.updateNode)

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      if (selectedZoneId) {
        updateNode(selectedZoneId, { polygon: newPolygon })
      }
    },
    [selectedZoneId, updateNode],
  )

  if (!zone || !zone.polygon || zone.polygon.length < 3) return null

  const zoneColor = zone.color || '#3b82f6'

  return (
    <PolygonEditor
      polygon={zone.polygon}
      color={zoneColor}
      onPolygonChange={handlePolygonChange}
      minVertices={3}
    />
  )
}
