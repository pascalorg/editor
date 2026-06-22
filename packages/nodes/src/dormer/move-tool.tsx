'use client'

import {
  type AnyNodeId,
  type DormerNode,
  DormerNode as DormerNodeSchema,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { DormerPlacementGuides } from './placement-guides'
import DormerPreview from './preview'
import { useDormerPlacement } from './use-dormer-placement'

/**
 * Drag-to-place tool for dormer duplicate / move. Receives the moving
 * node (a clone with `id` stripped + `metadata.isNew = true` after a
 * Duplicate action) via `node` prop, shows the same ghost preview as
 * placement, and on click commits the cloned dormer to the hit segment.
 *
 * On cancel, a duplicate clone is deleted and an existing dormer is
 * restored to its original segment + position. Mounted via
 * `def.affordanceTools.move`.
 */
const MoveDormerTool = ({ node }: { node: DormerNode }) => {
  const setSelection = useViewer((s) => s.setSelection)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  // Ghost data — same as the moving clone but pinned to position[0,0,0]
  // (the outer groups place it on the roof). Reparse so Zod fills any
  // defaults missing from the clone.
  const previewNode = useMemo(() => {
    const { id: _id, ...rest } = node
    return DormerNodeSchema.parse({
      ...rest,
      position: [0, 0, 0],
      rotation: 0,
    })
  }, [node])

  // Hide the moving dormer while dragging. Restored in cleanup or on
  // commit. We also mark metadata.isTransient so any other consumer
  // (e.g. the inspector) can short-circuit.
  const meta =
    typeof node.metadata === 'object' && node.metadata !== null
      ? (node.metadata as Record<string, unknown>)
      : {}
  const isNew = !!meta.isNew
  const originalRotation = node.rotation ?? 0
  const originalMetadata = node.metadata

  // biome-ignore lint/correctness/useExhaustiveDependencies: capture-on-mount; meta is intentionally not re-read on changes.
  useEffect(() => {
    if (!isNew) {
      useScene.getState().updateNode(node.id as AnyNodeId, {
        metadata: { ...meta, isTransient: true },
      })
    }
    const dormerObj = sceneRegistry.nodes.get(node.id)
    const prevVisible = dormerObj?.visible
    if (dormerObj) dormerObj.visible = false

    return () => {
      // Restore visibility + metadata if the move was cancelled.
      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = prevVisible ?? true
      if (!isNew) {
        useScene.getState().updateNode(node.id as AnyNodeId, {
          metadata: originalMetadata,
        })
      }
    }
  }, [node.id, isNew])

  const { activeBuildingId, segmentXform, hitSegment, hitLocal, ghostRotation } =
    useDormerPlacement({
      initialRotation: originalRotation,
      relativeStart: {
        position: [...node.position] as [number, number, number],
        roofSegmentId: node.roofSegmentId,
      },
      onCommit: (hit, rotation) => {
        const state = useScene.getState()

        // Strip the `isNew` / `isTransient` flags — only used to mark a
        // clone or in-flight move that hasn't been committed yet.
        const cleanedMeta = (() => {
          const m =
            node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
              ? (node.metadata as Record<string, unknown>)
              : {}
          const {
            isNew: _isNew,
            isTransient: _isTransient,
            ...rest
          } = m as {
            isNew?: boolean
            isTransient?: boolean
          }
          return Object.keys(rest).length > 0 ? rest : undefined
        })()

        if (isNew || !node.id) {
          const { id: _id, ...rest } = node
          const committed = DormerNodeSchema.parse({
            ...rest,
            roofSegmentId: hit.segment.id,
            parentId: hit.segment.id,
            position: [hit.localX, hit.localY, hit.localZ],
            rotation,
            metadata: cleanedMeta,
          })
          state.createNode(committed, hit.segment.id as AnyNodeId)
          state.dirtyNodes.add(hit.segment.id as AnyNodeId)
          setSelection({ selectedIds: [committed.id] })
        } else {
          const prevSegmentId = node.roofSegmentId as AnyNodeId | undefined
          state.updateNode(node.id as AnyNodeId, {
            roofSegmentId: hit.segment.id,
            parentId: hit.segment.id,
            position: [hit.localX, hit.localY, hit.localZ],
            rotation,
            metadata: cleanedMeta,
          })
          if (prevSegmentId) state.dirtyNodes.add(prevSegmentId)
          state.dirtyNodes.add(hit.segment.id as AnyNodeId)
          // Unlist from previous segment's children and add to the new one.
          if (prevSegmentId && prevSegmentId !== (hit.segment.id as AnyNodeId)) {
            const prevSeg = state.nodes[prevSegmentId] as RoofSegmentNode | undefined
            if (prevSeg) {
              state.updateNode(prevSegmentId, {
                children: (prevSeg.children ?? []).filter((id) => id !== node.id),
              })
            }
            const newSeg = state.nodes[hit.segment.id as AnyNodeId] as RoofSegmentNode | undefined
            if (newSeg && !(newSeg.children ?? []).includes(node.id)) {
              state.updateNode(hit.segment.id as AnyNodeId, {
                children: [...(newSeg.children ?? []), node.id],
              })
            }
          }
          setSelection({ selectedIds: [node.id] })
        }
        const dormerObj = sceneRegistry.nodes.get(node.id)
        if (dormerObj) dormerObj.visible = true
        setMovingNode(null)
      },
    })

  if (!activeBuildingId || !segmentXform || !hitLocal) return null

  return (
    <group position={segmentXform.position} quaternion={segmentXform.quaternion}>
      {hitSegment && (
        <DormerPlacementGuides
          center={hitLocal}
          depth={previewNode.depth}
          movingId={node.id}
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
  )
}

export default MoveDormerTool
