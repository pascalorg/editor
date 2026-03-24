import { type AnyNodeId, type RoofNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'

/**
 * Imperatively toggles the Three.js visibility of roof objects based on the
 * editor selection — without causing React re-renders in RoofRenderer.
 *
 * When a roof (or one of its segments) is selected:
 *   - merged-roof mesh is hidden
 *   - segments-wrapper group is shown (individual segments visible for editing)
 *   - all children are marked dirty so RoofSystem rebuilds their geometry
 *
 * When deselected:
 *   - merged-roof mesh is shown
 *   - segments-wrapper group is hidden
 */
export const RoofEditSystem = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const prevActiveRoofIds = useRef(new Set<string>())

  useEffect(() => {
    const nodes = useScene.getState().nodes

    // Collect which roof nodes should be in "edit mode"
    const activeRoofIds = new Set<string>()
    for (const id of selectedIds) {
      const node = nodes[id as AnyNodeId]
      if (!node) continue
      if (node.type === 'roof') {
        activeRoofIds.add(id)
      } else if (node.type === 'roof-segment' && node.parentId) {
        activeRoofIds.add(node.parentId)
      }
    }

    // Update all roofs that are currently active OR were previously active
    const roofIdsToUpdate = new Set([...activeRoofIds, ...prevActiveRoofIds.current])

    for (const roofId of roofIdsToUpdate) {
      const group = sceneRegistry.nodes.get(roofId)
      if (!group) continue

      const mergedMesh = group.getObjectByName('merged-roof')
      const segmentsWrapper = group.getObjectByName('segments-wrapper')
      const isActive = activeRoofIds.has(roofId)

      if (mergedMesh) mergedMesh.visible = !isActive
      if (segmentsWrapper) segmentsWrapper.visible = isActive

      const roofNode = nodes[roofId as AnyNodeId] as RoofNode | undefined
      if (roofNode?.children?.length) {
        const wasActive = prevActiveRoofIds.current.has(roofId)
        if (isActive !== wasActive) {
          // Entering edit mode: rebuild individual segment geometries
          // Exiting edit mode: sync transforms + rebuild merged mesh
          const { markDirty } = useScene.getState()
          for (const childId of roofNode.children) {
            markDirty(childId as AnyNodeId)
          }
        }
      }
    }

    prevActiveRoofIds.current = activeRoofIds
  }, [selectedIds])

  return null
}
