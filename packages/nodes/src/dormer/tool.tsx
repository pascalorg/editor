'use client'

import { type AnyNodeId, DormerNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { dormerDefinition } from './definition'
import { DormerPlacementGuides } from './placement-guides'
import DormerPreview from './preview'
import { useDormerPlacement } from './use-dormer-placement'

/**
 * Pick the smallest free integer suffix for a new dormer name so the
 * scene tree doesn't end up with multiple `Dormer 3`s after deletes.
 */
function nextDormerNumber(nodes: Record<string, unknown>): number {
  const used = new Set<number>()
  for (const node of Object.values(nodes)) {
    if (!node || typeof node !== 'object') continue
    const n = node as { type?: string; name?: string }
    if (n.type !== 'dormer') continue
    const m = n.name?.match(/^Dormer (\d+)$/)
    if (m?.[1]) used.add(Number.parseInt(m[1], 10))
  }
  let n = 1
  while (used.has(n)) n++
  return n
}

/**
 * Placement tool for a fresh dormer. The dormer sits UPRIGHT on the
 * host segment at segment-local `y = 0` (the host wall foot) — the
 * CSG inside `generateDormerGeometry` carves the dormer against the
 * host roof's slope, so we don't tilt or lift it here. The ghost is
 * mounted on the hit segment's world transform (extracted via the
 * registry) so the user sees exactly where the dormer will land.
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
      onCommit: (hit, rotation) => {
        const state = useScene.getState()
        const dormer = DormerNode.parse({
          ...dormerDefinition.defaults(),
          name: `Dormer ${nextDormerNumber(state.nodes)}`,
          roofSegmentId: hit.segment.id,
          parentId: hit.segment.id,
          // Anchor at the slope height so the renderer matches the ghost.
          // The CSG still carves cleanly because it inverts T(position)
          // when bringing the host into dormer-local.
          position: [hit.localX, hit.localY, hit.localZ],
          rotation,
        })
        state.createNode(dormer, hit.segment.id as AnyNodeId)
        state.dirtyNodes.add(hit.segment.id as AnyNodeId)
        setSelection({ selectedIds: [dormer.id] })
      },
    })

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
