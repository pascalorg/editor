import { type AnyNodeId, type StairNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef } from 'react'

/**
 * Imperatively toggles the Three.js visibility of stair objects based on the
 * editor selection — without causing React re-renders in StairRenderer.
 *
 * When a stair (or one of its segments) is selected:
 *   - merged-stair mesh is hidden
 *   - segments-wrapper group is shown (individual segments visible for editing)
 *   - all children are marked dirty so StairSystem rebuilds their geometry
 *
 * When deselected:
 *   - merged-stair mesh is shown
 *   - segments-wrapper group is hidden
 */
export const StairEditSystem = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedStairSignature = useScene(
    useCallback(
      (state) =>
        selectedIds
          .map((id) => {
            const node = state.nodes[id as AnyNodeId]
            if (!node) return null
            if (node.type === 'stair') {
              return `${node.id}:${node.stairType}`
            }
            if (node.type === 'stair-segment' && node.parentId) {
              const parent = state.nodes[node.parentId as AnyNodeId] as StairNode | undefined
              return parent?.type === 'stair' ? `${parent.id}:${parent.stairType}` : null
            }
            return null
          })
          .filter(Boolean)
          .join('|'),
      [selectedIds],
    ),
  )
  const prevActiveStairIds = useRef(new Set<string>())

  useEffect(() => {
    const nodes = useScene.getState().nodes

    // Collect which stair nodes should be in "edit mode"
    const activeStairIds = new Set<string>()
    for (const id of selectedIds) {
      const node = nodes[id as AnyNodeId]
      if (!node) continue
      if (node.type === 'stair') {
        activeStairIds.add(id)
      } else if (node.type === 'stair-segment' && node.parentId) {
        activeStairIds.add(node.parentId)
      }
    }

    // Update all stairs that are currently active OR were previously active
    const stairIdsToUpdate = new Set([...activeStairIds, ...prevActiveStairIds.current])

    for (const stairId of stairIdsToUpdate) {
      const group = sceneRegistry.nodes.get(stairId)
      if (!group) continue

      const stairNode = nodes[stairId as AnyNodeId] as StairNode | undefined
      const isCurved = stairNode?.stairType === 'curved' || stairNode?.stairType === 'spiral'
      const mergedMesh = group.getObjectByName('merged-stair')
      const segmentsWrapper = group.getObjectByName('segments-wrapper')
      const isActive = activeStairIds.has(stairId)

      if (mergedMesh) mergedMesh.visible = !isActive && !isCurved
      if (segmentsWrapper) segmentsWrapper.visible = isActive && !isCurved

      if (stairNode?.children?.length) {
        const wasActive = prevActiveStairIds.current.has(stairId)
        if (isActive !== wasActive) {
          // Entering edit mode: rebuild individual segment geometries
          // Exiting edit mode: sync transforms + rebuild merged mesh
          const { markDirty } = useScene.getState()
          for (const childId of stairNode.children) {
            markDirty(childId as AnyNodeId)
          }
        }
      }
    }

    prevActiveStairIds.current = activeStairIds
  }, [selectedIds, selectedStairSignature])

  return null
}
