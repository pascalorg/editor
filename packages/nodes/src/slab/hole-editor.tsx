'use client'

import { resolveLevelId, type SlabNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { PolygonEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect } from 'react'

/**
 * Phase 5 Stage D — slab hole editor (registry-driven).
 *
 * Edits a specific hole polygon inside a slab. Mounted by ToolManager
 * via `def.affordanceTools['hole-edit']` when `useEditor.editingHole`
 * is set on the selected slab.
 */
export const SlabHoleEditor: React.FC<{ slabId: SlabNode['id']; holeIndex: number }> = ({
  slabId,
  holeIndex,
}) => {
  const slabNode = useScene((s) => s.nodes[slabId])
  const updateNode = useScene((s) => s.updateNode)
  const markDirty = useScene((s) => s.markDirty)
  const setSelection = useViewer((s) => s.setSelection)

  const slab = slabNode?.type === 'slab' ? (slabNode as SlabNode) : null
  const holes = slab?.holes || []
  const hole = holes[holeIndex]
  const metadata = slab?.holeMetadata?.[holeIndex]

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      const updatedHoles = [...holes]
      updatedHoles[holeIndex] = newPolygon
      updateNode(slabId, { holes: updatedHoles })
      setSelection({ selectedIds: [slabId] })
    },
    [slabId, holeIndex, holes, updateNode, setSelection],
  )

  // Live-preview the in-flight hole onto the slab via
  // `useLiveNodeOverrides.holes` so `GeometrySystem` rebuilds the CSG
  // cut while the user is still dragging. Single store commit happens
  // through `handlePolygonChange` on release.
  const handlePolygonPreview = useCallback(
    (preview: ReadonlyArray<readonly [number, number]> | null) => {
      if (preview) {
        const updatedHoles = [...holes]
        updatedHoles[holeIndex] = preview.map(([x, z]) => [x, z] as [number, number])
        useLiveNodeOverrides.getState().set(slabId, { holes: updatedHoles })
      } else {
        useLiveNodeOverrides.getState().clear(slabId)
      }
      markDirty(slabId)
    },
    [slabId, holeIndex, holes, markDirty],
  )

  useEffect(() => {
    return () => {
      useLiveNodeOverrides.getState().clear(slabId)
      useScene.getState().markDirty(slabId)
    }
  }, [slabId])

  if (!(slab && hole) || hole.length < 3 || metadata?.source !== 'manual') return null

  return (
    <PolygonEditor
      allowEdgeMove
      allowPolygonMove
      color="#ef4444"
      levelId={resolveLevelId(slab, useScene.getState().nodes)}
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      onPolygonPreview={handlePolygonPreview}
      polygon={hole}
      surfaceHeight={slab.elevation ?? 0.05}
    />
  )
}

export default SlabHoleEditor
