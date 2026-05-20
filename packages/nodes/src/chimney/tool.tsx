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
import { chimneyDefinition } from './definition'
import ChimneyPreview from './preview'

const worldPoint = new THREE.Vector3()

type SegmentHit = {
  segment: RoofSegmentNode
  localX: number
  localY: number
  localZ: number
}

function resolveSegmentFromWorldPoint(
  roof: RoofNode,
  wx: number,
  wy: number,
  wz: number,
  state: ReturnType<typeof useScene.getState>,
): SegmentHit | null {
  worldPoint.set(wx, wy, wz)
  for (const childId of roof.children ?? []) {
    const seg = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
    if (seg?.type !== 'roof-segment') continue
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) continue
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(worldPoint.clone())
    if (Math.abs(local.x) <= seg.width / 2 && Math.abs(local.z) <= seg.depth / 2) {
      return { segment: seg, localX: local.x, localY: local.y, localZ: local.z }
    }
  }
  return null
}

/**
 * Chimney placement tool. Listens to `roof:*` events; the preview
 * follows the cursor across the segment with the segment's yaw applied
 * (chimney itself stays world-vertical, so no slope tilt wrap). Click
 * creates a new ChimneyNode parented to that segment with
 * segment-local position.
 */
const ChimneyTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  const [previewPos, setPreviewPos] = useState<[number, number, number] | null>(null)
  const [previewYaw, setPreviewYaw] = useState(0)
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

      const state = useScene.getState()
      const hit = resolveSegmentFromWorldPoint(event.node as RoofNode, wx, wy, wz, state)
      if (!hit) return

      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0))
      setPreviewPos(worldToBuildingLocal(wx, wy, wz))
      setPreviewSegment(hit.segment)
      event.stopPropagation()
    }

    const onClick = (event: RoofEvent) => {
      const state = useScene.getState()
      const hit = resolveSegmentFromWorldPoint(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
        state,
      )
      if (!hit) return

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

  if (!activeBuildingId || !previewPos || !previewSegment) return null

  return (
    <group position={previewPos}>
      <group rotation-y={previewYaw}>
        <ChimneyPreview node={previewNode} segment={previewSegment} />
      </group>
    </group>
  )
}

export default ChimneyTool
