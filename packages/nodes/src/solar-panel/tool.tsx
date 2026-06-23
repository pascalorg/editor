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
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { resolveRoofSegmentHit } from '../shared/roof-segment-hit'
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
 * segment's roof type + dimensions). On commit, snaps the position's
 * Y to the segment's surface height and stores the analytical normal
 * in the node so the renderer reproduces the same orientation.
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
  // The committed panel still uses the full residential defaults (4×5).
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

      const hit = resolveRoofSegmentHit(event.node as RoofNode, wx, wy, wz)
      if (!hit) return

      const normal = getAnalyticalNormal(hit.localX, hit.localZ, hit.segment)
      setPreviewSurfaceQuat(surfaceQuatFromNormal(normal, new THREE.Quaternion()))
      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0))
      setPreviewPos(worldToBuildingLocal(wx, wy, wz))
      publishRoofSurfacePlacementGuides({
        roof: event.node as RoofNode,
        segment: hit.segment,
        center: [hit.localX, hit.localY, hit.localZ],
        footprint: roofSurfaceFootprintFromNode(previewNode),
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

      // Use the raycast hit Y (segment-local) and analytical normal so the
      // committed panel sits exactly where the ghost was rendered. The
      // analytical `getSurfaceY` is the bare-rafter height — it ignores
      // deck/shingle layers and sinks the panel into the roof, producing
      // a visible jump between ghost and committed mesh.
      const normal = getAnalyticalNormal(hit.localX, hit.localZ, hit.segment)

      const panel = SolarPanelNode.parse({
        ...solarPanelDefinition.defaults(),
        name: 'Solar Panel',
        roofSegmentId: hit.segment.id,
        position: [hit.localX, hit.localY, hit.localZ],
        rotation: 0,
        surfaceNormal: [normal.x, normal.y, normal.z],
      })
      state.createNode(panel, hit.segment.id as AnyNodeId)
      state.dirtyNodes.add(hit.segment.id as AnyNodeId)
      setSelection({ selectedIds: [panel.id] })
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
        ghost={<SolarPanelPreview node={previewNode} invalid />}
        onInvalidTarget={() => {
          setPreviewPos(null)
          setPreviewSurfaceQuat(null)
          clearRoofSurfacePlacementGuides()
        }}
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
