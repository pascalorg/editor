'use client'

import {
  type AnyNodeId,
  emitter,
  type RoofEvent,
  type RoofNode,
  SolarPanelNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { triggerSFX, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import {
  resolveRoofSegmentHit,
  roofElementAtClick,
  roofEventWitness,
} from '../shared/roof-segment-hit'
import { getAnalyticalNormal, surfaceQuatFromNormal } from '../shared/roof-surface'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfacePlacementGuides,
  roofSurfaceFootprintFromNode,
} from '../shared/roof-surface-placement-guides'
import { solarPanelDefinition } from './definition'
import SolarPanelPreview from './preview'

const worldPoint = new THREE.Vector3()

/**
 * Solar panel placement tool. The preview shows the array at the
 * cursor with the analytical roof-surface tilt applied (no raycast in
 * the placement preview — uses `getAnalyticalNormal` derived from the
 * segment's roof type + dimensions). Commit preserves the physical hit
 * and stores the analytical normal so the renderer reproduces the tilt.
 */
const SolarPanelTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  const [previewPos, setPreviewPos] = useState<[number, number, number] | null>(null)
  const [previewYaw, setPreviewYaw] = useState(0)
  const [previewSurfaceQuat, setPreviewSurfaceQuat] = useState<THREE.Quaternion | null>(null)
  const lastSnapRef = useRef<[number, number] | null>(null)

  // Compact 2×3 ghost (rows × columns) — small enough to read as a
  // pointer, large enough to show the array's orientation/aspect.
  // The committed panel uses the same native 2×3 defaults.
  const previewNode = useMemo(
    () =>
      SolarPanelNode.parse({
        ...solarPanelDefinition.defaults(),
        name: 'Solar Panel',
        position: [0, 0, 0],
        rotation: 0,
        rows: 2,
        columns: 3,
      }),
    [],
  )

  const clearPreview = useCallback(() => {
    setPreviewPos(null)
    setPreviewSurfaceQuat(null)
    const placementPreview = usePlacementPreview.getState()
    if (placementPreview.node?.id === previewNode.id) placementPreview.clear()
    clearRoofSurfacePlacementGuides()
  }, [previewNode.id])

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

      const hit = resolveRoofSegmentHit(event.node as RoofNode, wx, wy, wz, roofEventWitness(event))
      if (!hit) {
        clearPreview()
        return
      }

      const normal = getAnalyticalNormal(hit.localX, hit.localZ, hit.segment)
      setPreviewSurfaceQuat(surfaceQuatFromNormal(normal, new THREE.Quaternion()))
      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0))
      setPreviewPos(worldToBuildingLocal(wx, wy, wz))
      usePlacementPreview.getState().set(
        SolarPanelNode.parse({
          ...previewNode,
          parentId: hit.segment.id,
          position: [hit.localX, hit.localY, hit.localZ],
          roofSegmentId: hit.segment.id,
          surfaceNormal: [normal.x, normal.y, normal.z],
        }),
        hit.segment,
      )
      publishRoofSurfacePlacementGuides({
        roof: event.node as RoofNode,
        segment: hit.segment,
        center: [hit.localX, hit.localY, hit.localZ],
        footprint: roofSurfaceFootprintFromNode(previewNode),
      })
      event.stopPropagation()
    }

    const onClick = (event: RoofEvent) => {
      const placed = roofElementAtClick(
        'solar-panel',
        event.node as RoofNode,
        event.position,
        undefined,
        roofEventWitness(event),
      )
      if (!placed) {
        clearPreview()
        return
      }
      const { node: panel, segmentId } = placed
      const state = useScene.getState()

      state.createNode(panel, segmentId)
      state.dirtyNodes.add(segmentId)
      setSelection({ selectedIds: [panel.id] })
      triggerSFX('sfx:item-place')
      const placementPreview = usePlacementPreview.getState()
      if (placementPreview.node?.id === previewNode.id) placementPreview.clear()
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
      const placementPreview = usePlacementPreview.getState()
      if (placementPreview.node?.id === previewNode.id) placementPreview.clear()
      clearRoofSurfacePlacementGuides()
    }
  }, [activeBuildingId, setSelection, previewNode, clearPreview])

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<SolarPanelPreview node={previewNode} invalid />}
        onInvalidTarget={clearPreview}
      />
      {activeBuildingId && previewPos && previewSurfaceQuat && (
        <group position={previewPos}>
          <group rotation-y={previewYaw}>
            <group quaternion={previewSurfaceQuat}>
              <SolarPanelPreview node={previewNode} />
            </group>
          </group>
        </group>
      )}
    </>
  )
}

export default SolarPanelTool
