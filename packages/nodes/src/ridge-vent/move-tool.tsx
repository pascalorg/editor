'use client'

import {
  type AnyNodeId,
  emitter,
  type RidgeVentNode,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { markToolCancelConsumed, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useState } from 'react'
import * as THREE from 'three'
import { resolveRoofSegmentHit } from '../roof/segment-hit'
import RidgeVentPreview from './preview'

/**
 * Ridge-vent move tool. Mirrors the box-vent move flow — ghost follows
 * the cursor over any roof segment, click commits the new position +
 * parent segment in one undoable step. The ridge sits along the ridge
 * line, so we don't tilt the preview by the segment slope (the renderer
 * places the vent on the peak); we just yaw it with the roof + segment.
 */
export default function MoveRidgeVentTool({ node }: { node: RidgeVentNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const [previewPos, setPreviewPos] = useState<[number, number, number] | null>(null)
  const [previewYaw, setPreviewYaw] = useState(0)

  useEffect(() => {
    useScene.temporal.getState().pause()

    const original = {
      position: [...node.position] as [number, number, number],
      rotation: node.rotation ?? 0,
      roofSegmentId: node.roofSegmentId,
      parentId: node.parentId,
      metadata: node.metadata,
    }
    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    const ventObj = sceneRegistry.nodes.get(node.id)
    if (ventObj) ventObj.visible = false

    const worldToBuildingLocal = (wx: number, wy: number, wz: number): [number, number, number] => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      if (!buildingObj) return [wx, wy, wz]
      const v = new THREE.Vector3(wx, wy, wz)
      buildingObj.worldToLocal(v)
      return [v.x, v.y, v.z]
    }

    let lastSnap: [number, number] | null = null

    const updatePreview = (event: RoofEvent) => {
      const wx = event.position[0]
      const wy = event.position[1]
      const wz = event.position[2]

      const sx = Math.round(wx * 20) / 20
      const sz = Math.round(wz * 20) / 20
      if (!lastSnap || lastSnap[0] !== sx || lastSnap[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        lastSnap = [sx, sz]
      }

      const hit = resolveRoofSegmentHit(event.node as RoofNode, wx, wy, wz)
      if (!hit) return

      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0))
      setPreviewPos(worldToBuildingLocal(wx, wy, wz))
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      const hit = resolveRoofSegmentHit(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
      )
      if (!hit) return
      const targetSegmentId = hit.segment.id as AnyNodeId
      const st = useScene.getState()

      const prevSegmentId = original.roofSegmentId as AnyNodeId | undefined
      if (prevSegmentId && prevSegmentId !== targetSegmentId) {
        const oldSeg = st.nodes[prevSegmentId] as RoofSegmentNode | undefined
        if (oldSeg) {
          st.updateNode(prevSegmentId, {
            children: (oldSeg.children ?? []).filter((id) => id !== node.id),
          })
        }
        const newSeg = st.nodes[targetSegmentId] as RoofSegmentNode | undefined
        if (newSeg && !(newSeg.children ?? []).includes(node.id)) {
          st.updateNode(targetSegmentId, {
            children: [...(newSeg.children ?? []), node.id],
          })
        }
        st.dirtyNodes.add(prevSegmentId)
      }

      useScene.temporal.getState().resume()
      st.updateNode(node.id as AnyNodeId, {
        roofSegmentId: targetSegmentId,
        parentId: targetSegmentId,
        position: [hit.localX, hit.localY, hit.localZ],
        rotation: original.rotation,
        visible: true,
        metadata: {},
      })
      useScene.temporal.getState().pause()

      st.dirtyNodes.add(targetSegmentId)
      st.dirtyNodes.add(node.id as AnyNodeId)

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true

      triggerSFX('sfx:item-place')
      exitMoveMode()
      event.stopPropagation()
    }

    const onCancel = () => {
      if (isNew) {
        const parentId = original.roofSegmentId as AnyNodeId | undefined
        if (parentId) {
          const parent = useScene.getState().nodes[parentId] as RoofSegmentNode | undefined
          if (parent) {
            useScene.getState().updateNode(parentId, {
              children: (parent.children ?? []).filter((id) => id !== node.id),
            })
          }
        }
        useScene.getState().deleteNode(node.id as AnyNodeId)
        useScene.temporal.getState().resume()
        markToolCancelConsumed()
        exitMoveMode()
        return
      }

      useScene.getState().updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })
      if (original.roofSegmentId) {
        useScene.getState().dirtyNodes.add(original.roofSegmentId as AnyNodeId)
      }
      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true

      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('roof:move', updatePreview)
    emitter.on('roof:enter', updatePreview)
    emitter.on('roof:click', onRoofClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('roof:move', updatePreview)
      emitter.off('roof:enter', updatePreview)
      emitter.off('roof:click', onRoofClick)
      emitter.off('tool:cancel', onCancel)

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true
      useScene.temporal.getState().resume()
    }
  }, [exitMoveMode, node])

  if (!previewPos) return null

  return (
    <group position={previewPos}>
      <group rotation-y={previewYaw}>
        <RidgeVentPreview node={node} />
      </group>
    </group>
  )
}
