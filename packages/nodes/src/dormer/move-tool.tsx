'use client'

import {
  type AnyNodeId,
  type DormerNode,
  DormerNode as DormerNodeSchema,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  validateDormerPlacement,
} from '@pascal-app/core'
import { commitFreshPlacementSubtree, useEditor, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
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
  // commit. Transient metadata is a live override, never a document/history edit.
  const meta =
    typeof node.metadata === 'object' && node.metadata !== null
      ? (node.metadata as Record<string, unknown>)
      : {}
  const isNew = !!meta.isNew
  const originalRotation = node.rotation ?? 0
  const committedRef = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: capture-on-mount; meta is intentionally not re-read on changes.
  useEffect(() => {
    if (!isNew) {
      useLiveNodeOverrides.getState().set(node.id, {
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
      if (isNew) {
        if (node.id && useScene.getState().nodes[node.id]) {
          useScene.getState().deleteNode(node.id as AnyNodeId)
        }
        useScene.temporal.getState().resume()
      } else {
        useLiveNodeOverrides.getState().clearFields(node.id, ['metadata'])
      }
    }
  }, [node.id, isNew])

  const { activeBuildingId, clearPreview, segmentXform, hitSegment, hitLocal, ghostRotation } =
    useDormerPlacement({
      initialRotation: originalRotation,
      relativeStart: {
        position: [...node.position] as [number, number, number],
        roofSegmentId: node.roofSegmentId,
      },
      resolveProposal: (hit, rotation) => {
        const state = useScene.getState()
        const segment = state.nodes[hit.segment.id]
        if (state.readOnly || segment?.type !== 'roof-segment') return null
        const current = state.nodes[node.id]
        const candidate = {
          ...(current?.type === 'dormer' ? current : node),
          parentId: hit.segment.id,
          roofSegmentId: hit.segment.id,
          position: [hit.localX, hit.localY, hit.localZ] as [number, number, number],
          rotation,
        }
        return validateDormerPlacement(state.nodes, segment, candidate).ok
          ? { ...hit, segment }
          : null
      },
      onCommit: (hit, rotation) => {
        const state = useScene.getState()
        const segment = state.nodes[hit.segment.id]
        if (state.readOnly || committedRef.current || segment?.type !== 'roof-segment') return false
        const current = state.nodes[node.id]
        const source = current?.type === 'dormer' ? current : node

        // Strip the `isNew` / `isTransient` flags — only used to mark a
        // clone or in-flight move that hasn't been committed yet.
        const { isNew: _isNew, isTransient: _isTransient, ...cleanedMeta } = source.metadata
        const candidate: DormerNode = {
          ...source,
          roofSegmentId: hit.segment.id,
          parentId: hit.segment.id,
          position: [hit.localX, hit.localY, hit.localZ],
          rotation,
          metadata: cleanedMeta,
          visible: true,
        }
        if (!validateDormerPlacement(state.nodes, segment, candidate).ok) return false

        if (isNew && current?.type === 'dormer') {
          const committedId = commitFreshPlacementSubtree(node.id as AnyNodeId, candidate)
          if (!committedId) return false
          state.dirtyNodes.add(hit.segment.id as AnyNodeId)
          state.dirtyNodes.add(committedId)
          setSelection({ selectedIds: [committedId] })
        } else if (isNew || !node.id) {
          const { id: _id, ...rest } = candidate
          const committed = DormerNodeSchema.parse(rest)
          state.createNode(committed, hit.segment.id as AnyNodeId)
          if (!useScene.getState().nodes[committed.id]) return false
          state.dirtyNodes.add(hit.segment.id as AnyNodeId)
          setSelection({ selectedIds: [committed.id] })
        } else {
          const prevSegmentId = source.roofSegmentId as AnyNodeId | undefined
          state.applyNodeChanges({
            update: [
              {
                id: node.id,
                data: {
                  roofSegmentId: candidate.roofSegmentId,
                  parentId: candidate.parentId,
                  position: candidate.position,
                  rotation: candidate.rotation,
                  metadata: candidate.metadata,
                },
              },
            ],
          })
          if (prevSegmentId) state.dirtyNodes.add(prevSegmentId)
          state.dirtyNodes.add(hit.segment.id as AnyNodeId)
          setSelection({ selectedIds: [node.id] })
        }
        committedRef.current = true
        const dormerObj = sceneRegistry.nodes.get(node.id)
        if (dormerObj) dormerObj.visible = true
        setMovingNode(null)
        return true
      },
    })

  useEffect(() => {
    const preview = usePlacementPreview.getState()
    if (!(hitSegment && hitLocal)) {
      if (preview.node?.id === previewNode.id) preview.clear()
      return
    }
    preview.set(
      {
        ...previewNode,
        parentId: hitSegment.id,
        roofSegmentId: hitSegment.id,
        position: hitLocal,
        rotation: ghostRotation,
      },
      hitSegment,
    )
  }, [ghostRotation, hitLocal, hitSegment, previewNode])

  useEffect(
    () => () => {
      const preview = usePlacementPreview.getState()
      if (preview.node?.id === previewNode.id) preview.clear()
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
      )}
    </>
  )
}

export default MoveDormerTool
