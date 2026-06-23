'use client'

import {
  type AnyNodeId,
  ChimneyNode,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { resolveRoofSegmentHit } from '../shared/roof-segment-hit'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfacePlacementGuides,
  roofSurfaceFootprintFromNode,
} from '../shared/roof-surface-placement-guides'
import { chimneyDefinition } from './definition'
import ChimneyPreview from './preview'

/**
 * Chimney placement tool. Listens to `roof:*` events; the preview
 * follows the cursor across the segment with the segment's yaw applied
 * (chimney itself stays world-vertical, so no slope tilt wrap). Click
 * creates a new ChimneyNode parented to that segment with
 * segment-local position.
 */
const tmpMatrix = new THREE.Matrix4()
const tmpInv = new THREE.Matrix4()
const tmpPos = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()

type SegmentTransform = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

const ChimneyTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  // Building-local matrix of the host segment — drives the ghost's
  // outer-group transform so the preview lands inside the actual
  // segment's frame (matches the real renderer in `renderer.tsx`).
  const [segmentXform, setSegmentXform] = useState<SegmentTransform | null>(null)
  // Cursor position expressed in segment-local coords. Layered inside
  // the segment frame so the ghost slides with the cursor across the
  // segment's footprint.
  const [hitLocal, setHitLocal] = useState<[number, number, number] | null>(null)
  const [previewSegment, setPreviewSegment] = useState<RoofSegmentNode | null>(null)
  const lastSnapRef = useRef<[number, number] | null>(null)

  const previewNode = useMemo(
    () =>
      ChimneyNode.parse({
        ...chimneyDefinition.defaults(),
        name: 'Chimney',
        position: [0, 0, 0],
        rotation: 0,
      }),
    [],
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

    const updatePreview = (event: RoofEvent) => {
      const wx = event.position[0]
      const wy = event.position[1]
      const wz = event.position[2]

      const sx = Math.round(wx * 20) / 20
      const sz = Math.round(wz * 20) / 20
      const prev = lastSnapRef.current
      if (event.nativeEvent?.shiftKey !== true && (!prev || prev[0] !== sx || prev[1] !== sz)) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      const hit = resolveRoofSegmentHit(event.node as RoofNode, wx, wy, wz)
      if (!hit) return

      const xform = computeSegmentXform(hit.segment.id)
      if (!xform) return
      setSegmentXform(xform)
      setHitLocal([hit.localX, hit.localY, hit.localZ])
      setPreviewSegment(hit.segment)
      publishRoofSurfacePlacementGuides({
        roof: event.node as RoofNode,
        segment: hit.segment,
        center: [hit.localX, hit.localY, hit.localZ],
        footprint: roofSurfaceFootprintFromNode(previewNode, { segment: hit.segment }),
      })
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

      const chimney = ChimneyNode.parse({
        ...chimneyDefinition.defaults(),
        name: 'Chimney',
        roofSegmentId: hit.segment.id,
        position: [hit.localX, hit.localY, hit.localZ],
        rotation: 0,
      })
      state.createNode(chimney, hit.segment.id as AnyNodeId)
      state.dirtyNodes.add(hit.segment.id as AnyNodeId)
      setSelection({ selectedIds: [chimney.id] })
      triggerSFX('sfx:item-place')
      clearRoofSurfacePlacementGuides()
      event.stopPropagation()
    }

    emitter.on('roof:move', updatePreview)
    emitter.on('roof:enter', updatePreview)
    emitter.on('roof:click', onClick)

    return () => {
      emitter.off('roof:move', updatePreview)
      emitter.off('roof:enter', updatePreview)
      emitter.off('roof:click', onClick)
      clearRoofSurfacePlacementGuides()
    }
  }, [activeBuildingId, setSelection, previewNode])

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<ChimneyPreview node={previewNode} invalid />}
        onInvalidTarget={() => {
          setSegmentXform(null)
          setHitLocal(null)
          setPreviewSegment(null)
          clearRoofSurfacePlacementGuides()
        }}
      />
      {activeBuildingId && segmentXform && hitLocal && previewSegment && (
        // Outer group mirrors the real renderer's `position={segment.position}
        // rotation-y={segment.rotation}` chain by composing the segment's
        // building-local matrix (which walks roof + level + segment). Inner
        // group offsets by the cursor's segment-local x/z so the chimney
        // geometry (built with `position[0,2] = 0`) lands under the cursor.
        <group position={segmentXform.position} quaternion={segmentXform.quaternion}>
          <group position={[hitLocal[0], 0, hitLocal[2]]}>
            <ChimneyPreview node={previewNode} segment={previewSegment} />
          </group>
        </group>
      )}
    </>
  )
}

export default ChimneyTool
