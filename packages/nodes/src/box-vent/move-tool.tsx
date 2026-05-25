'use client'

import {
  type AnyNodeId,
  type BoxVentNode,
  emitter,
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
import { getAnalyticalNormal, surfaceQuatFromNormal } from '../solar-panel/geometry'
import BoxVentPreview from './preview'

/**
 * Box-vent move tool. Mirrors the placement tool's cursor behaviour
 * (ghost follows the roof surface; click on a roof commits) but for an
 * already-existing vent: the original mesh is hidden during the drag,
 * the ghost tracks the cursor with the correct slope tilt + segment yaw,
 * and the click updates the node's position + parent segment in one
 * undoable step. Cancel restores the original transform; if the node was
 * freshly cloned (`metadata.isNew`), cancel deletes it instead.
 */
export default function MoveBoxVentTool({ node }: { node: BoxVentNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const [previewPos, setPreviewPos] = useState<[number, number, number] | null>(null)
  const [previewSurfaceQuat, setPreviewSurfaceQuat] = useState<THREE.Quaternion | null>(null)
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

      const normal = getAnalyticalNormal(hit.localX, hit.localZ, hit.segment)
      setPreviewSurfaceQuat(surfaceQuatFromNormal(normal, new THREE.Quaternion()))
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

      // Reparent if the cursor landed on a different segment than the
      // node currently belongs to. Mirrors the skylight move flow:
      // remove the node id from the old segment's children, append to
      // the new one, mark both dirty so the merged-roof system rebuilds.
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
        // Freshly-cloned vent — undo the clone entirely on cancel so the
        // user doesn't end up with an orphan they didn't intend to place.
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

      // Safety restore — if the tool is unmounted by something other than
      // a commit / cancel path (e.g. tool change, selection wipe), leave
      // the original mesh visible rather than stranded invisible.
      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true
      useScene.temporal.getState().resume()
    }
  }, [exitMoveMode, node])

  if (!(previewPos && previewSurfaceQuat)) return null

  return (
    <group position={previewPos}>
      <group rotation-y={previewYaw}>
        <group quaternion={previewSurfaceQuat}>
          <BoxVentPreview node={node} />
        </group>
      </group>
    </group>
  )
}
