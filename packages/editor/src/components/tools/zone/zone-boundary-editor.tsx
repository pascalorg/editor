import { resolveLevelId, useScene, type ZoneNode } from '@pascal-app/core'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

interface ZoneBoundaryEditorProps {
  zoneId: ZoneNode['id']
}

/**
 * Zone boundary editor - allows editing zone polygon vertices for a specific zone
 * Uses the generic PolygonEditor component
 */
export const ZoneBoundaryEditor: React.FC<ZoneBoundaryEditorProps> = ({ zoneId }) => {
  const zoneNode = useScene((state) => state.nodes[zoneId])
  const updateNode = useScene((state) => state.updateNode)

  const zone = zoneNode?.type === 'zone' ? (zoneNode as ZoneNode) : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      updateNode(zoneId, { polygon: newPolygon })
    },
    [zoneId, updateNode],
  )

  if (!zone || !zone.polygon || zone.polygon.length < 3) return null

  const zoneColor = zone.color || '#3b82f6'

  return (
    <PolygonEditor
      polygon={zone.polygon}
      color={zoneColor}
      onPolygonChange={handlePolygonChange}
      minVertices={3}
      levelId={resolveLevelId(zone, useScene.getState().nodes)}
    />
  )
}
