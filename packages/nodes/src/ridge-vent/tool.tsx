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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import {
  resolveRoofSegmentHit,
  roofElementAtClick,
  roofEventWitness,
  roofRidgeSnapAtHit,
} from '../shared/roof-segment-hit'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfacePlacementGuides,
  roofSurfaceFootprintFromNode,
} from '../shared/roof-surface-placement-guides'
import { ridgeVentDefinition } from './definition'
import RidgeVentPreview from './preview'

const worldPoint = new THREE.Vector3()

/**
 * Ridge vent placement tool. The cursor preview snaps to the nearest
 * ridge/break line of whichever segment is under the cursor, since the
 * cap needs to straddle a real roof crease.
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

  const clearPreview = useCallback(() => {
    setPreviewPos(null)
    clearRoofSurfacePlacementGuides()
  }, [])

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
        roofEventWitness(event),
      )
      if (!hit) {
        clearPreview()
        return
      }

      // Project the cursor onto the nearest segment ridge/break line.
      // The preview then moves along that line as the cursor moves — never
      // off it. Flat segments have no ridge: hide.
      const snap = roofRidgeSnapAtHit(event.node as RoofNode, hit)
      if (!snap) {
        clearPreview()
        return
      }
      const segObj = sceneRegistry.nodes.get(hit.segment.id)
      let ridgeWorld: [number, number, number]
      if (segObj) {
        const ridgeLocal = new THREE.Vector3(snap.localX, snap.localY, snap.localZ)
        segObj.updateWorldMatrix(true, false)
        ridgeLocal.applyMatrix4(segObj.matrixWorld)
        ridgeWorld = [ridgeLocal.x, ridgeLocal.y, ridgeLocal.z]
      } else {
        ridgeWorld = [event.position[0], event.position[1], event.position[2]]
      }

      const sx = Math.round(ridgeWorld[0] * 20) / 20
      const sz = Math.round(ridgeWorld[2] * 20) / 20
      const prev = lastSnapRef.current
      if (event.nativeEvent?.shiftKey !== true && (!prev || prev[0] !== sx || prev[1] !== sz)) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0) + snap.rotation)
      setPreviewPos(worldToBuildingLocal(ridgeWorld[0], ridgeWorld[1], ridgeWorld[2]))
      publishRoofSurfacePlacementGuides({
        roof: event.node as RoofNode,
        segment: hit.segment,
        center: [snap.localX, snap.localY, snap.localZ],
        footprint: roofSurfaceFootprintFromNode(previewNode),
        mode: 'linear-edge',
      })
      event.stopPropagation()
    }

    const onClick = (event: RoofEvent) => {
      const placed = roofElementAtClick(
        'ridge-vent',
        event.node as RoofNode,
        event.position,
        undefined,
        roofEventWitness(event),
      )
      if (!placed) {
        clearPreview()
        return
      }
      const { node: vent, segmentId } = placed
      const state = useScene.getState()

      state.createNode(vent, segmentId)
      state.dirtyNodes.add(segmentId)
      setSelection({ selectedIds: [vent.id] })
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
  }, [activeBuildingId, setSelection, previewNode, clearPreview])

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<RidgeVentPreview node={previewNode} invalid />}
        isValidRoofTarget={(event) => {
          const hit = resolveRoofSegmentHit(
            event.node as RoofNode,
            event.position[0],
            event.position[1],
            event.position[2],
            roofEventWitness(event),
          )
          return !!hit && !!roofRidgeSnapAtHit(event.node as RoofNode, hit)
        }}
        onInvalidTarget={clearPreview}
      />
      {activeBuildingId && previewPos && (
        <group position={previewPos}>
          <group rotation-y={previewYaw}>
            <RidgeVentPreview node={previewNode} />
          </group>
        </group>
      )}
    </>
  )
}

export default RidgeVentTool
