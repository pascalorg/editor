'use client'

import {
  type AnyNodeId,
  type ChimneyNode,
  ChimneyNode as ChimneyNodeSchema,
  emitter,
  type RoofEvent,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  consumePlacementDragRelease,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  createRelativeRoofDrag,
  type RelativeRoofDragTarget,
  snapRelativeRoofDragTarget,
} from '../shared/relative-roof-drag'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfaceNodePlacementGuides,
  snapRoofSurfaceNodeTarget,
} from '../shared/roof-surface-placement-guides'
import ChimneyPreview from './preview'

const tmpMatrix = new THREE.Matrix4()
const tmpInv = new THREE.Matrix4()
const tmpPos = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()

type SegmentTransform = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

/**
 * Drag-to-place tool for chimney duplicate / move. Receives the moving
 * node (a clone with `id` stripped + `metadata.isNew = true` after a
 * Duplicate action) via `node` prop, shows the same ghost preview as
 * placement, and on click commits the cloned chimney to the hit
 * segment with that segment's local coords.
 *
 * Mirrors `tool.tsx`'s placement preview — the only differences are
 * (a) the ghost is built from the moving node so the duplicate
 * preserves the original's body shape/material/etc., and (b) on click
 * we keep all of the clone's fields and only overwrite host segment +
 * position. Mounted via `def.affordanceTools.move`.
 */
const MoveChimneyTool = ({ node }: { node: ChimneyNode }) => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const [segmentXform, setSegmentXform] = useState<SegmentTransform | null>(null)
  const [hitLocal, setHitLocal] = useState<[number, number, number] | null>(null)
  const [previewSegment, setPreviewSegment] = useState<RoofSegmentNode | null>(null)
  const lastSnapRef = useRef<[number, number] | null>(null)

  // Ghost data — same as the moving clone but pinned to position[0,0,0]
  // (the inner group does the cursor offset). Reparse so Zod fills any
  // defaults missing from the clone.
  const previewNode = useMemo(
    () =>
      ChimneyNodeSchema.parse({
        ...node,
        id: 'chimney_preview' as never,
        position: [0, 0, 0],
        rotation: 0,
      }),
    [node],
  )

  useEffect(() => {
    if (!activeBuildingId) return
    useScene.temporal.getState().pause()

    const original = {
      position: [...node.position] as [number, number, number],
      rotation: node.rotation ?? 0,
      roofSegmentId: node.roofSegmentId,
      parentId: node.parentId,
      metadata: node.metadata,
    }
    const meta =
      node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    if (node.id) {
      const chimneyObj = sceneRegistry.nodes.get(node.id)
      if (chimneyObj) chimneyObj.visible = false
    }

    const computeSegmentXform = (segmentId: string): SegmentTransform | null => {
      const buildingObj = sceneRegistry.nodes.get(activeBuildingId as AnyNodeId)
      const segObj = sceneRegistry.nodes.get(segmentId as AnyNodeId)
      if (!(buildingObj && segObj)) return null
      buildingObj.updateWorldMatrix(true, false)
      segObj.updateWorldMatrix(true, false)
      tmpInv.copy(buildingObj.matrixWorld).invert()
      tmpMatrix.multiplyMatrices(tmpInv, segObj.matrixWorld)
      tmpMatrix.decompose(tmpPos, tmpQuat, tmpScale)
      return {
        position: [tmpPos.x, tmpPos.y, tmpPos.z],
        quaternion: [tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w],
      }
    }

    let lastTarget: RelativeRoofDragTarget | null = null
    let committed = false
    const roofDrag = createRelativeRoofDrag({
      position: original.position,
      roofSegmentId: original.roofSegmentId,
    })

    const resolveSnappedTarget = (event: RoofEvent): RelativeRoofDragTarget | null => {
      const rawTarget = roofDrag.resolve(event)
      if (!rawTarget) return null
      return snapRoofSurfaceNodeTarget({
        target: snapRelativeRoofDragTarget(rawTarget, event.nativeEvent?.shiftKey === true),
        node,
        bypass: event.nativeEvent?.shiftKey === true,
      })
    }

    const clearTarget = () => {
      lastTarget = null
      setSegmentXform(null)
      setHitLocal(null)
      setPreviewSegment(null)
      clearRoofSurfacePlacementGuides()
    }

    const updatePreview = (event: RoofEvent) => {
      const target = resolveSnappedTarget(event)
      if (!target) return clearTarget()

      const sx = Math.round(target.localX * 20) / 20
      const sz = Math.round(target.localZ * 20) / 20
      const prev = lastSnapRef.current
      if (event.nativeEvent?.shiftKey !== true && (!prev || prev[0] !== sx || prev[1] !== sz)) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      const xform = computeSegmentXform(target.segment.id)
      if (!xform) return clearTarget()
      lastTarget = target
      setSegmentXform(xform)
      setHitLocal([target.localX, target.localY, target.localZ])
      setPreviewSegment(target.segment)
      publishRoofSurfaceNodePlacementGuides({
        roof: event.node,
        segment: target.segment,
        center: [target.localX, target.localY, target.localZ],
        node,
      })
      event.stopPropagation()
    }

    const onClick = (event: RoofEvent) => {
      if (committed) return
      const target = lastTarget ?? resolveSnappedTarget(event)
      if (!target) return
      committed = true
      const state = useScene.getState()

      // Strip the `isNew` flag — only used to mark a duplicate clone
      // that hasn't been committed yet.
      const { isNew, ...restMeta } = meta as { isNew?: boolean }
      const cleanedMeta = Object.keys(restMeta).length > 0 ? restMeta : undefined
      const targetSegmentId = target.segment.id as AnyNodeId

      // Duplicate (clone with no committed id yet) → create a fresh
      // chimney parented to the hit segment. Plain move (existing id,
      // no `isNew` flag) → update host + position in place. Either way
      // every other field from the clone is preserved.
      if (isNew || !node.id) {
        const committed = ChimneyNodeSchema.parse({
          ...node,
          id: undefined as never,
          roofSegmentId: target.segment.id,
          parentId: target.segment.id,
          position: [target.localX, target.localY, target.localZ],
          visible: true,
          metadata: cleanedMeta,
        })
        useScene.temporal.getState().resume()
        state.applyNodeChanges({
          delete: node.id ? [node.id as AnyNodeId] : [],
          create: [{ node: committed, parentId: targetSegmentId }],
        })
        state.dirtyNodes.add(targetSegmentId)
        setSelection({ selectedIds: [committed.id] })
        useScene.temporal.getState().pause()
      } else {
        const prevSegmentId = original.roofSegmentId as AnyNodeId | undefined
        const reparenting = Boolean(prevSegmentId && prevSegmentId !== targetSegmentId)
        // Resume BEFORE any scene edits so the reparent (both segments'
        // children arrays + the chimney's own host/position update) lands as
        // one tracked transaction. Otherwise undo reverts the chimney but
        // leaves the children arrays inconsistent with its parentId.
        useScene.temporal.getState().resume()
        if (reparenting) {
          const oldSeg = state.nodes[prevSegmentId!] as RoofSegmentNode | undefined
          if (oldSeg) {
            state.updateNode(prevSegmentId!, {
              children: (oldSeg.children ?? []).filter((id) => id !== node.id),
            })
          }
          const newSeg = state.nodes[targetSegmentId] as RoofSegmentNode | undefined
          if (newSeg && !(newSeg.children ?? []).includes(node.id)) {
            state.updateNode(targetSegmentId, {
              children: [...(newSeg.children ?? []), node.id],
            })
          }
          state.dirtyNodes.add(prevSegmentId!)
        }
        state.updateNode(node.id as AnyNodeId, {
          roofSegmentId: target.segment.id,
          parentId: target.segment.id,
          position: [target.localX, target.localY, target.localZ],
          rotation: original.rotation,
          visible: true,
          metadata: cleanedMeta,
        })
        useScene.temporal.getState().pause()
        state.dirtyNodes.add(targetSegmentId)
        state.dirtyNodes.add(node.id as AnyNodeId)
        setSelection({ selectedIds: [node.id] })
      }
      const obj = node.id && !isNew ? sceneRegistry.nodes.get(node.id) : null
      if (obj) obj.visible = true
      clearRoofSurfacePlacementGuides()
      setMovingNode(null)
      triggerSFX('sfx:item-place')
      event.stopPropagation()
    }

    const onCancel = () => {
      if (isNew) {
        if (node.id) {
          const parentId = original.roofSegmentId as AnyNodeId | undefined
          if (parentId) {
            const parent = useScene.getState().nodes[parentId] as RoofSegmentNode | undefined
            if (parent) {
              useScene.getState().updateNode(parentId, {
                children: (parent.children ?? []).filter((id) => id !== node.id),
              })
            }
          }
          useScene.getState().deleteNode(node.id as AnyNodeId)
        }
        useScene.temporal.getState().resume()
        markToolCancelConsumed()
        clearRoofSurfacePlacementGuides()
        setMovingNode(null)
        return
      }

      if (node.id) {
        useScene.getState().updateNode(node.id as AnyNodeId, {
          position: original.position,
          rotation: original.rotation,
          roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
          parentId: original.parentId as AnyNodeId | undefined,
          metadata: original.metadata,
        })
        if (original.roofSegmentId) {
          useScene.getState().dirtyNodes.add(original.roofSegmentId as AnyNodeId)
        }
        const obj = sceneRegistry.nodes.get(node.id)
        if (obj) obj.visible = true
      }

      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      clearRoofSurfacePlacementGuides()
      setMovingNode(null)
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      if (!lastTarget) return
      onClick({
        nativeEvent: event,
        stopPropagation: () => event.stopPropagation(),
      } as unknown as RoofEvent)
    }

    emitter.on('roof:move', updatePreview)
    emitter.on('roof:enter', updatePreview)
    emitter.on('roof:click', onClick)
    emitter.on('roof:leave', clearTarget)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      emitter.off('roof:move', updatePreview)
      emitter.off('roof:enter', updatePreview)
      emitter.off('roof:click', onClick)
      emitter.off('roof:leave', clearTarget)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)

      if (node.id) {
        const obj = sceneRegistry.nodes.get(node.id)
        if (obj) obj.visible = true
      }
      clearRoofSurfacePlacementGuides()
      useScene.temporal.getState().resume()
    }
  }, [activeBuildingId, node, setMovingNode, setSelection])

  if (!activeBuildingId || !segmentXform || !hitLocal || !previewSegment) return null

  return (
    <group position={segmentXform.position} quaternion={segmentXform.quaternion}>
      <group position={[hitLocal[0], 0, hitLocal[2]]}>
        <ChimneyPreview node={previewNode} segment={previewSegment} />
      </group>
    </group>
  )
}

export default MoveChimneyTool
