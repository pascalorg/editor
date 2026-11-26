'use client'

import { type AnyNodeId, DormerNode, planDormerCreation, useScene } from '@pascal-app/core'
import { usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { dormerDefinition } from './definition'
import { DormerPlacementGuides } from './placement-guides'
import DormerPreview from './preview'
import { useDormerPlacement } from './use-dormer-placement'

/**
 * Preview and commit share the native bare-shell seat and pair planner.
 * The ghost remains mounted in the supplying segment's frame.
 */
const DormerTool = () => {
  const setSelection = useViewer((s) => s.setSelection)

  const previewNode = useMemo(
    () =>
      DormerNode.parse({
        ...dormerDefinition.defaults(),
        name: 'Dormer',
        position: [0, 0, 0],
        rotation: 0,
      }),
    [],
  )

  const { activeBuildingId, clearPreview, segmentXform, hitSegment, hitLocal, ghostRotation } =
    useDormerPlacement({
      resolveProposal: (hit, rotation) => {
        const state = useScene.getState()
        const segment = state.nodes[hit.segment.id]
        if (state.readOnly || segment?.type !== 'roof-segment') return null
        const plan = planDormerCreation(state.nodes, segment, [hit.localX, hit.localZ], {
          rotation,
        })
        return plan.ok ? { ...hit, segment, localY: plan.value.dormer.position[1] } : null
      },
      onCommit: (hit, rotation) => {
        const state = useScene.getState()
        const segment = state.nodes[hit.segment.id]
        if (state.readOnly || segment?.type !== 'roof-segment') return false
        const plan = planDormerCreation(state.nodes, segment, [hit.localX, hit.localZ], {
          rotation,
        })
        if (!plan.ok) return false
        const { dormer, window } = plan.value
        state.applyNodeChanges({
          create: [
            { node: dormer, parentId: hit.segment.id },
            { node: window, parentId: dormer.id },
          ],
        })
        if (!useScene.getState().nodes[dormer.id]) return false
        state.dirtyNodes.add(hit.segment.id as AnyNodeId)
        setSelection({ selectedIds: [dormer.id] })
        usePlacementPreview.getState().clear()
        return true
      },
    })

  useEffect(() => {
    const placementPreview = usePlacementPreview.getState()
    if (!(hitSegment && hitLocal)) {
      if (placementPreview.node?.id === previewNode.id) placementPreview.clear()
      return
    }
    placementPreview.set(
      DormerNode.parse({
        ...previewNode,
        parentId: hitSegment.id,
        position: hitLocal,
        roofSegmentId: hitSegment.id,
        rotation: ghostRotation,
      }),
      hitSegment,
    )
  }, [ghostRotation, hitLocal, hitSegment, previewNode])

  useEffect(
    () => () => {
      const placementPreview = usePlacementPreview.getState()
      if (placementPreview.node?.id === previewNode.id) placementPreview.clear()
    },
    [previewNode.id],
  )

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<DormerPreview node={previewNode} invalid />}
        onInvalidTarget={clearPreview}
      />
      {activeBuildingId && segmentXform && hitLocal && (
        <group position={segmentXform.position} quaternion={segmentXform.quaternion}>
          {hitSegment && (
            <DormerPlacementGuides
              center={hitLocal}
              depth={previewNode.depth}
              rotation={ghostRotation}
              segment={hitSegment}
              width={previewNode.width}
            />
          )}
          <group position={hitLocal}>
            <group rotation-y={ghostRotation}>
              <DormerPreview node={previewNode} />
            </group>
          </group>
        </group>
      )}
    </>
  )
}

export default DormerTool
