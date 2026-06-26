'use client'

import {
  type AnyNodeId,
  BoxVentNode,
  emitter,
  type RoofEvent,
  type RoofNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { resolveRoofSegmentHit } from '../shared/roof-segment-hit'
import { getAnalyticalNormal, getDownSlopeYaw, surfaceQuatFromNormal } from '../shared/roof-surface'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfacePlacementGuides,
  roofSurfaceFootprintFromNode,
} from '../shared/roof-surface-placement-guides'
import { boxVentDefinition } from './definition'
import BoxVentPreview from './preview'

const worldPoint = new THREE.Vector3()

/**
 * Box-vent placement tool. Mounts when the palette activates the
 * box-vent kind; listens for `roof:*` events; on click commits a new
 * `BoxVentNode` parented to the targeted segment with segment-local
 * coordinates.
 *
 * Cursor preview follows the roof surface: position from `roof:move`,
 * slope tilt from the segment under the cursor, segment yaw from the
 * roof + segment rotation stack.
 */
const BoxVentTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  const [previewPos, setPreviewPos] = useState<[number, number, number] | null>(null)
  const [previewSurfaceQuat, setPreviewSurfaceQuat] = useState<THREE.Quaternion | null>(null)
  const [previewYaw, setPreviewYaw] = useState(0)
  const [previewRotation, setPreviewRotation] = useState(0)
  const lastSnapRef = useRef<[number, number] | null>(null)

  // Default-shaped preview node — matches what the commit will create.
  const previewNode = useMemo(
    () =>
      BoxVentNode.parse({
        ...boxVentDefinition.defaults(),
        name: 'Box Vent',
        position: [0, 0, 0],
        rotation: previewRotation,
      }),
    [previewRotation],
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
      setPreviewRotation(getDownSlopeYaw(hit.localX, hit.localZ, hit.segment))
      setPreviewPos(worldToBuildingLocal(wx, wy, wz))
      publishRoofSurfacePlacementGuides({
        roof: event.node as RoofNode,
        segment: hit.segment,
        center: [hit.localX, hit.localY, hit.localZ],
        footprint: roofSurfaceFootprintFromNode({
          ...previewNode,
          rotation: getDownSlopeYaw(hit.localX, hit.localZ, hit.segment),
        }),
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

      const vent = BoxVentNode.parse({
        ...boxVentDefinition.defaults(),
        name: 'Box Vent',
        roofSegmentId: hit.segment.id,
        position: [hit.localX, hit.localY, hit.localZ],
        rotation: getDownSlopeYaw(hit.localX, hit.localZ, hit.segment),
      })
      state.createNode(vent, hit.segment.id as AnyNodeId)
      state.dirtyNodes.add(hit.segment.id as AnyNodeId)
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
  }, [activeBuildingId, setSelection, previewNode])

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<BoxVentPreview node={previewNode} invalid />}
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
              <BoxVentPreview node={previewNode} />
            </group>
          </group>
        </group>
      )}
    </>
  )
}

export default BoxVentTool
