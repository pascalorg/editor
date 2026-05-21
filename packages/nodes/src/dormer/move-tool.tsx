'use client'

import {
  type AnyNodeId,
  type DormerNode,
  DormerNode as DormerNodeSchema,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { resolveRoofSegmentHit } from '../roof/segment-hit'
import DormerPreview from './preview'

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
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const [segmentXform, setSegmentXform] = useState<SegmentTransform | null>(null)
  const [hitLocal, setHitLocal] = useState<[number, number, number] | null>(null)
  const lastSnapRef = useRef<[number, number] | null>(null)

  // Ghost data — same as the moving clone but pinned to position[0,0,0]
  // (the outer groups place it on the roof). Reparse so Zod fills any
  // defaults missing from the clone.
  const previewNode = useMemo(
    () =>
      DormerNodeSchema.parse({
        ...node,
        id: 'dormer_preview' as never,
        position: [0, 0, 0],
        rotation: 0,
      }),
    [node],
  )

  useEffect(() => {
    if (!activeBuildingId) return

    // Hide the moving dormer while dragging. Restored in cleanup or on
    // commit. We also mark metadata.isTransient so any other consumer
    // (e.g. the inspector) can short-circuit.
    const original = {
      position: [...node.position] as [number, number, number],
      rotation: node.rotation ?? 0,
      roofSegmentId: node.roofSegmentId,
      parentId: node.parentId,
      metadata: node.metadata,
    }
    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew
    if (!isNew) {
      useScene.getState().updateNode(node.id as AnyNodeId, {
        metadata: { ...meta, isTransient: true },
      })
    }
    const dormerObj = sceneRegistry.nodes.get(node.id)
    const prevVisible = dormerObj?.visible
    if (dormerObj) dormerObj.visible = false

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

    const updatePreview = (event: RoofEvent) => {
      const wx = event.position[0]
      const wy = event.position[1]
      const wz = event.position[2]

      const sx = Math.round(wx * 20) / 20
      const sz = Math.round(wz * 20) / 20
      const prev = lastSnapRef.current
      if (!prev || prev[0] !== sx || prev[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      const hit = resolveRoofSegmentHit(event.node as RoofNode, wx, wy, wz)
      if (!hit) return

      const xform = computeSegmentXform(hit.segment.id)
      if (!xform) return
      setSegmentXform(xform)
      // Track the actual roof-surface Y so the ghost stays under the
      // cursor along the slope. See note on the placement tool — CSG
      // carves the host against the dormer regardless of `position[1]`.
      setHitLocal([hit.localX, hit.localY, hit.localZ])
      event.stopPropagation()
    }

    const onClick = (event: RoofEvent) => {
      const hit = resolveRoofSegmentHit(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
      )
      if (!hit) return
      const state = useScene.getState()

      // Strip the `isNew` / `isTransient` flags — only used to mark a
      // clone or in-flight move that hasn't been committed yet.
      const cleanedMeta = (() => {
        const m =
          node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
            ? (node.metadata as Record<string, unknown>)
            : {}
        const { isNew: _isNew, isTransient: _isTransient, ...rest } = m as {
          isNew?: boolean
          isTransient?: boolean
        }
        return Object.keys(rest).length > 0 ? rest : undefined
      })()

      if (isNew || !node.id) {
        const committed = DormerNodeSchema.parse({
          ...node,
          id: undefined as never,
          roofSegmentId: hit.segment.id,
          parentId: hit.segment.id,
          position: [hit.localX, hit.localY, hit.localZ],
          rotation: original.rotation,
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
          rotation: original.rotation,
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
      if (dormerObj) dormerObj.visible = prevVisible ?? true
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
      // Restore visibility + metadata if the move was cancelled.
      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = prevVisible ?? true
      if (!isNew) {
        useScene.getState().updateNode(node.id as AnyNodeId, {
          metadata: original.metadata,
        })
      }
    }
  }, [activeBuildingId, node, setMovingNode, setSelection])

  if (!activeBuildingId || !segmentXform || !hitLocal) return null

  return (
    <group position={segmentXform.position} quaternion={segmentXform.quaternion}>
      <group position={hitLocal}>
        <group rotation-y={node.rotation ?? 0}>
          <DormerPreview node={previewNode} />
        </group>
      </group>
    </group>
  )
}

export default MoveDormerTool
