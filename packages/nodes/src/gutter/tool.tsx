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
import GutterPreview from './preview'

const worldPoint = new THREE.Vector3()

/**
 * Gutter placement tool. Cursor preview snaps to the eave line of the
 * roof-segment under the cursor — eave = segment-local
 * `(Z = +depth/2, Y = wallHeight)`. Click commits a new `GutterNode`
 * parented to that segment with `position = [hitX, wallHeight,
 * +depth/2]` so the back wall of the gutter sits flush against the
 * fascia.
 *
 * X (along the eave) is taken from the cursor's segment-local X so the
 * user controls where along the eave the gutter starts; the length L/R
 * handles + inspector cover follow-up tweaks.
 *
 * Snapping is purely a placement convenience — the inspector / handles
 * can move the gutter off the eave afterward if a custom run is needed.
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

      // Snap the cursor to the eave line of the hit segment by clamping
      // localZ to +depth/2 and localY to wallHeight. Convert back to
      // world via the segment's matrixWorld, then into building-local
      // for the React group position.
      const segObj = sceneRegistry.nodes.get(hit.segment.id)
      const eaveZ = (hit.segment.depth ?? 0) / 2
      const eaveY = hit.segment.wallHeight ?? 0
      let eaveWorld: [number, number, number]
      if (segObj) {
        const eaveLocal = new THREE.Vector3(hit.localX, eaveY, eaveZ)
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

      // Yaw the preview to match the segment's rotation so the
      // gutter visually runs along the eave instead of holding the
      // building's rotation.
      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0))
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

      const eaveZ = (hit.segment.depth ?? 0) / 2
      const eaveY = hit.segment.wallHeight ?? 0

      const gutter = GutterNode.parse({
        ...gutterDefinition.defaults(),
        name: 'Gutter',
        roofSegmentId: hit.segment.id,
        // X follows the cursor's segment-local X; Y / Z snap to the eave.
        position: [hit.localX, eaveY, eaveZ],
        rotation: 0,
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
