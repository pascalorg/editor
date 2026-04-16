import { type CeilingNode, resolveLevelId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

interface CeilingRegionEditorProps {
  ceilingId: CeilingNode['id']
  regionIndex: number
}

/**
 * Ceiling region editor — drags a single region's outer polygon on a
 * tray/stepped ceiling. Mirrors CeilingHoleEditor, but writes back to
 * `regions[regionIndex].polygon` and renders handles at the region's
 * own height (which may be above or below the main ceiling).
 */
export const CeilingRegionEditor: React.FC<CeilingRegionEditorProps> = ({
  ceilingId,
  regionIndex,
}) => {
  const ceilingNode = useScene((state) => state.nodes[ceilingId])
  const updateNode = useScene((state) => state.updateNode)
  const setSelection = useViewer((state) => state.setSelection)

  const ceiling = ceilingNode?.type === 'ceiling' ? (ceilingNode as CeilingNode) : null
  const regions = ceiling?.regions || []
  const region = regions[regionIndex]

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      if (!region) return
      const updatedRegions = [...regions]
      updatedRegions[regionIndex] = { ...region, polygon: newPolygon }
      updateNode(ceilingId, { regions: updatedRegions })
      setSelection({ selectedIds: [ceilingId] })
    },
    [ceilingId, regionIndex, region, regions, updateNode, setSelection],
  )

  if (!(ceiling && region) || region.polygon.length < 3) return null

  return (
    <PolygonEditor
      color="#f59e0b"
      levelId={resolveLevelId(ceiling, useScene.getState().nodes)}
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      polygon={region.polygon}
      surfaceHeight={region.height}
    />
  )
}
