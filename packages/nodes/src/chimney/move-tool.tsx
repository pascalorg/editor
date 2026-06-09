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
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { createRelativeRoofDrag, type RelativeRoofDragTarget } from '../shared/relative-roof-drag'
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
    const roofDrag = createRelativeRoofDrag({
      position: [...node.position] as [number, number, number],
      roofSegmentId: node.roofSegmentId,
    })

    const updatePreview = (event: RoofEvent) => {
      const target = roofDrag.resolve(event)
      if (!target) return
      lastTarget = target

      const sx = Math.round(target.localX * 20) / 20
      const sz = Math.round(target.localZ * 20) / 20
      const prev = lastSnapRef.current
      if (!prev || prev[0] !== sx || prev[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      const xform = computeSegmentXform(target.segment.id)
      if (!xform) return
      setSegmentXform(xform)
      setHitLocal([target.localX, target.localY, target.localZ])
      setPreviewSegment(target.segment)
      event.stopPropagation()
    }

    const onClick = (event: RoofEvent) => {
      const target = lastTarget ?? roofDrag.resolve(event)
      if (!target) return
      const state = useScene.getState()

      // Strip the `isNew` flag — only used to mark a duplicate clone
      // that hasn't been committed yet.
      const meta =
        node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
          ? (node.metadata as Record<string, unknown>)
          : {}
      const { isNew, ...restMeta } = meta as { isNew?: boolean }
      const cleanedMeta = Object.keys(restMeta).length > 0 ? restMeta : undefined

      // Duplicate (clone with no committed id yet) → create a fresh
      // chimney parented to the hit segment. Plain move (existing id,
      // no `isNew` flag) → update host + position in place. Either way
      // every other field from the clone is preserved.
      if (isNew || !node.id) {
        const committed = ChimneyNodeSchema.parse({
          ...node,
          id: undefined as never,
          roofSegmentId: target.segment.id,
          position: [target.localX, target.localY, target.localZ],
          metadata: cleanedMeta,
        })
        state.createNode(committed, target.segment.id as AnyNodeId)
        state.dirtyNodes.add(target.segment.id as AnyNodeId)
        setSelection({ selectedIds: [committed.id] })
      } else {
        const prevSegmentId = node.roofSegmentId as AnyNodeId | undefined
        state.updateNode(node.id as AnyNodeId, {
          roofSegmentId: target.segment.id,
          parentId: target.segment.id,
          position: [target.localX, target.localY, target.localZ],
          metadata: cleanedMeta,
        })
        if (prevSegmentId) state.dirtyNodes.add(prevSegmentId)
        state.dirtyNodes.add(target.segment.id as AnyNodeId)
        setSelection({ selectedIds: [node.id] })
      }
      setMovingNode(null)
      triggerSFX('sfx:item-place')
      event.stopPropagation()
    }

    emitter.on('roof:move', updatePreview)
    emitter.on('roof:enter', updatePreview)
    emitter.on('roof:click', onClick)

    return () => {
      emitter.off('roof:move', updatePreview)
      emitter.off('roof:enter', updatePreview)
      emitter.off('roof:click', onClick)
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
