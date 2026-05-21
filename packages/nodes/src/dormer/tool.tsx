'use client'

import {
  type AnyNodeId,
  DormerNode,
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
import { resolveRoofSegmentHit } from '../roof/segment-hit'
import { dormerDefinition } from './definition'
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
 * Placement tool for a fresh dormer. The dormer sits UPRIGHT on the
 * host segment at segment-local `y = 0` (the host wall foot) — the
 * CSG inside `generateDormerGeometry` carves the dormer against the
 * host roof's slope, so we don't tilt or lift it here. The ghost is
 * mounted on the hit segment's world transform (extracted via the
 * registry) so the user sees exactly where the dormer will land.
 */
const DormerTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  const [segmentXform, setSegmentXform] = useState<SegmentTransform | null>(null)
  const [hitLocal, setHitLocal] = useState<[number, number, number] | null>(null)
  const [previewSegment, setPreviewSegment] = useState<RoofSegmentNode | null>(null)
  const lastSnapRef = useRef<[number, number] | null>(null)

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
      if (!prev || prev[0] !== sx || prev[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      const hit = resolveRoofSegmentHit(event.node as RoofNode, wx, wy, wz)
      if (!hit) return

      const xform = computeSegmentXform(hit.segment.id)
      if (!xform) return
      setSegmentXform(xform)
      // Lift the ghost to the actual roof-surface Y at the cursor so
      // it tracks the mouse along the slope. The CSG inside
      // `generateDormerGeometry` carves the dormer against the host
      // roof regardless of `position[1]` — the host_solid is shifted
      // by -position[1] into dormer-local before subtraction — so
      // anchoring at the cursor height is purely a visual alignment.
      setHitLocal([hit.localX, hit.localY, hit.localZ])
      setPreviewSegment(hit.segment)
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

      const dormer = DormerNode.parse({
        ...dormerDefinition.defaults(),
        name: 'Dormer',
        roofSegmentId: hit.segment.id,
        parentId: hit.segment.id,
        // Anchor at the slope height so the renderer matches the ghost.
        // The CSG still carves cleanly because it inverts T(position)
        // when bringing the host into dormer-local.
        position: [hit.localX, hit.localY, hit.localZ],
        rotation: 0,
      })
      state.createNode(dormer, hit.segment.id as AnyNodeId)
      state.dirtyNodes.add(hit.segment.id as AnyNodeId)
      setSelection({ selectedIds: [dormer.id] })
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
  }, [activeBuildingId, setSelection])

  if (!activeBuildingId || !segmentXform || !hitLocal || !previewSegment) return null

  return (
    <group position={segmentXform.position} quaternion={segmentXform.quaternion}>
      <group position={hitLocal}>
        <DormerPreview node={previewNode} />
      </group>
    </group>
  )
}

export default DormerTool
