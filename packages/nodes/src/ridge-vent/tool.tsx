'use client'

import {
  type AnyNodeId,
  emitter,
  RidgeVentNode,
  type RoofEvent,
  type RoofNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { resolveRoofSegmentHit } from '../roof/segment-hit'
import { ridgeVentDefinition } from './definition'
import RidgeVentPreview from './preview'

const worldPoint = new THREE.Vector3()

/**
 * Ridge vent placement tool. The cursor preview snaps to the ridge
 * (Z=0 in segment-local space) of whichever segment is under the
 * cursor, since the ridge vent's whole purpose is to sit on the peak.
 * Click anywhere on a segment commits the vent at the ridge directly
 * above that hit (X stays where the cursor was, Z snaps to 0).
 */
const RidgeVentTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  const [previewPos, setPreviewPos] = useState<[number, number, number] | null>(null)
  const [previewYaw, setPreviewYaw] = useState(0)
  const lastSnapRef = useRef<[number, number] | null>(null)

  const previewNode = useMemo(
    () =>
      RidgeVentNode.parse({
        ...ridgeVentDefinition.defaults(),
        name: 'Ridge Vent',
        position: [0, 0, 0],
        rotation: 0,
      }),
    [],
  )

  useEffect(() => {
    if (!activeBuildingId) return

    const worldToBuildingLocal = (wx: number, wy: number, wz: number): [number, number, number] => {
      const buildingObj = sceneRegistry.nodes.get(activeBuildingId as AnyNodeId)
      if (!buildingObj) return [wx, wy, wz]
      worldPoint.set(wx, wy, wz)
      buildingObj.worldToLocal(worldPoint)
      return [worldPoint.x, worldPoint.y, worldPoint.z]
    }

    const updatePreview = (event: RoofEvent) => {
      const hit = resolveRoofSegmentHit(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
      )
      if (!hit) return

      // Snap the cursor to the ridge by zeroing localZ via the
      // segment's local frame, then convert back through the building.
      const segObj = sceneRegistry.nodes.get(hit.segment.id)
      let ridgeWorld: [number, number, number]
      if (segObj) {
        const ridgeLocal = new THREE.Vector3(hit.localX, hit.localY, 0)
        segObj.updateWorldMatrix(true, false)
        ridgeLocal.applyMatrix4(segObj.matrixWorld)
        ridgeWorld = [ridgeLocal.x, ridgeLocal.y, ridgeLocal.z]
      } else {
        ridgeWorld = [event.position[0], event.position[1], event.position[2]]
      }

      const sx = Math.round(ridgeWorld[0] * 20) / 20
      const sz = Math.round(ridgeWorld[2] * 20) / 20
      const prev = lastSnapRef.current
      if (!prev || prev[0] !== sx || prev[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0))
      setPreviewPos(worldToBuildingLocal(ridgeWorld[0], ridgeWorld[1], ridgeWorld[2]))
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

      const vent = RidgeVentNode.parse({
        ...ridgeVentDefinition.defaults(),
        name: 'Ridge Vent',
        roofSegmentId: hit.segment.id,
        // Snap Z to 0 — ridge vents straddle the ridge line.
        position: [hit.localX, hit.localY, 0],
        rotation: 0,
      })
      state.createNode(vent, hit.segment.id as AnyNodeId)
      state.dirtyNodes.add(hit.segment.id as AnyNodeId)
      setSelection({ selectedIds: [vent.id] })
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

  if (!activeBuildingId || !previewPos) return null

  return (
    <group position={previewPos}>
      <group rotation-y={previewYaw}>
        <RidgeVentPreview node={previewNode} />
      </group>
    </group>
  )
}

export default RidgeVentTool
