'use client'

import {
  type AnyNodeId,
  emitter,
  GutterNode,
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
import { gutterDefinition } from './definition'
import { resolveEaveSnap } from './eave-snap'
import GutterPreview from './preview'

const worldPoint = new THREE.Vector3()

/**
 * Gutter placement tool. Cursor preview snaps to the OUTER eave — the
 * drip edge of the roof, NOT the wall line. The eave sits at
 * `Z = ±(depth/2 + overhang)` in segment-local frame; the gutter
 * mounts against the fascia there, hanging outward from the building.
 *
 * Which eave: the sign of the cursor's segment-local Z picks the near
 * eave. `+Z` eave uses rotation=0 (length runs along +X, outward
 * along +Z). `-Z` eave uses rotation=π so the gutter's local +Z
 * (outward) maps to world -Z and the trough hangs away from the
 * building on the back slope too.
 *
 * Eave Y: the slope keeps descending past the wall edge by the
 * overhang span. For a slope of `pitch` radians, the slope drops
 * `overhang * tan(pitch)` between the wall edge (Z = ±depth/2,
 * Y = wallHeight) and the drip edge (Z = ±(depth/2 + overhang)).
 * Same formula gives the right answer for gable / hip / shed in the
 * common case — primary slope is the eave slope.
 *
 * X (along the eave) follows the cursor's segment-local X so the
 * user controls where along the eave the gutter starts; the length
 * L/R handles + inspector cover follow-up tweaks.
 *
 * Snapping is purely a placement convenience — the inspector /
 * handles can move the gutter off the eave afterward.
 */
const GutterTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  const [previewPos, setPreviewPos] = useState<[number, number, number] | null>(null)
  const [previewYaw, setPreviewYaw] = useState(0)
  const lastSnapRef = useRef<[number, number] | null>(null)

  const previewNode = useMemo(
    () =>
      GutterNode.parse({
        ...gutterDefinition.defaults(),
        name: 'Gutter',
        position: [0, 0, 0],
        rotation: 0,
      }),
    [],
  )

  useEffect(() => {
    if (!activeBuildingId) return

    const worldToBuildingLocal = (
      wx: number,
      wy: number,
      wz: number,
    ): [number, number, number] => {
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

      const snap = resolveEaveSnap(hit.segment, hit.localX, hit.localZ)
      const segObj = sceneRegistry.nodes.get(hit.segment.id)
      let eaveWorld: [number, number, number]
      if (segObj) {
        const eaveLocal = new THREE.Vector3(snap.eaveX, snap.eaveY, snap.eaveZ)
        segObj.updateWorldMatrix(true, false)
        eaveLocal.applyMatrix4(segObj.matrixWorld)
        eaveWorld = [eaveLocal.x, eaveLocal.y, eaveLocal.z]
      } else {
        eaveWorld = [event.position[0], event.position[1], event.position[2]]
      }

      const sx = Math.round(eaveWorld[0] * 20) / 20
      const sz = Math.round(eaveWorld[2] * 20) / 20
      const prev = lastSnapRef.current
      if (!prev || prev[0] !== sx || prev[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      // Yaw the preview to match the segment's rotation + the gutter's
      // own back-eave flip, so the trough visually hangs outward on
      // whichever eave the cursor is closer to.
      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0) + snap.rotation)
      setPreviewPos(worldToBuildingLocal(eaveWorld[0], eaveWorld[1], eaveWorld[2]))
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
      const snap = resolveEaveSnap(hit.segment, hit.localX, hit.localZ)

      const gutter = GutterNode.parse({
        ...gutterDefinition.defaults(),
        name: 'Gutter',
        roofSegmentId: hit.segment.id,
        // (X, Y, Z) all come from the eave snap — on ±Z eaves X stays
        // free along the cursor; on ±X eaves Z stays free instead.
        // Rotation orients the gutter's outward axis away from the
        // building on whichever side the click landed.
        position: [snap.eaveX, snap.eaveY, snap.eaveZ],
        rotation: snap.rotation,
      })
      state.createNode(gutter, hit.segment.id as AnyNodeId)
      state.dirtyNodes.add(hit.segment.id as AnyNodeId)
      setSelection({ selectedIds: [gutter.id] })
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
        <GutterPreview node={previewNode} />
      </group>
    </group>
  )
}

export default GutterTool
