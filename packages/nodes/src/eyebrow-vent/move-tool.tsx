'use client'

import {
  type AnyNodeId,
  type EyebrowVentNode,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  consumePlacementDragRelease,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useCallback, useEffect, useState } from 'react'
import * as THREE from 'three'
import {
  createRelativeRoofDrag,
  type RelativeRoofDragTarget,
  roofSegmentLocalToBuildingLocal,
  snapRelativeRoofDragTarget,
} from '../shared/relative-roof-drag'
import { getAnalyticalNormal, surfaceQuatFromNormal } from '../shared/roof-surface'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfaceNodePlacementGuides,
  snapRoofSurfaceNodeTarget,
} from '../shared/roof-surface-placement-guides'
import EyebrowVentPreview from './preview'

/**
 * Eyebrow-vent move tool. Mirrors the box-vent / cupola move flow: the
 * original mesh hides during the drag, a ghost tracks the cursor with the
 * correct slope tilt + segment yaw, and the click updates the node's position
 * + parent segment in one undoable step (reparenting between segments when
 * needed). Cancel restores the original transform, or deletes a freshly-cloned
 * vent.
 */
export default function MoveEyebrowVentTool({ node }: { node: EyebrowVentNode }) {
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

    let lastSnap: [number, number] | null = null
    let lastTarget: RelativeRoofDragTarget | null = null
    let committed = false
    const roofDrag = createRelativeRoofDrag(original)

    const clearTarget = () => {
      lastTarget = null
      lastSnap = null
      setPreviewPos(null)
      setPreviewSurfaceQuat(null)
      clearRoofSurfacePlacementGuides()
    }

    const resolveSnappedTarget = (event: RoofEvent): RelativeRoofDragTarget | null => {
      const rawTarget = roofDrag.resolve(event)
      if (!rawTarget) return null
      return snapRoofSurfaceNodeTarget({
        target: snapRelativeRoofDragTarget(rawTarget, event.nativeEvent?.shiftKey === true),
        node,
        bypass: event.nativeEvent?.shiftKey === true,
      })
    }

    const updatePreview = (event: RoofEvent) => {
      const target = resolveSnappedTarget(event)
      if (!target) {
        clearTarget()
        return
      }
      lastTarget = target

      const sx = Math.round(target.localX * 20) / 20
      const sz = Math.round(target.localZ * 20) / 20
      if (
        event.nativeEvent?.shiftKey !== true &&
        (!lastSnap || lastSnap[0] !== sx || lastSnap[1] !== sz)
      ) {
        triggerSFX('sfx:grid-snap')
        lastSnap = [sx, sz]
      }

      const normal = getAnalyticalNormal(target.localX, target.localZ, target.segment)
      setPreviewSurfaceQuat(surfaceQuatFromNormal(normal, new THREE.Quaternion()))
      setPreviewYaw((event.node.rotation ?? 0) + (target.segment.rotation ?? 0))
      setPreviewPos(
        roofSegmentLocalToBuildingLocal(target.segment.id, [
          target.localX,
          target.localY,
          target.localZ,
        ]),
      )
      publishRoofSurfaceNodePlacementGuides({
        roof: event.node as RoofNode,
        segment: target.segment,
        center: [target.localX, target.localY, target.localZ],
        node,
      })
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      if (committed) return
      const target = lastTarget ?? resolveSnappedTarget(event)
      if (!target) return
      committed = true
      const targetSegmentId = target.segment.id as AnyNodeId
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
        position: [target.localX, target.localY, target.localZ],
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
      clearRoofSurfacePlacementGuides()
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
        clearRoofSurfacePlacementGuides()
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
      clearRoofSurfacePlacementGuides()
      exitMoveMode()
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      if (!lastTarget) return
      onRoofClick({
        nativeEvent: event,
        stopPropagation: () => event.stopPropagation(),
      } as unknown as RoofEvent)
    }

    emitter.on('roof:move', updatePreview)
    emitter.on('roof:enter', updatePreview)
    emitter.on('roof:click', onRoofClick)
    emitter.on('roof:leave', clearTarget)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      emitter.off('roof:move', updatePreview)
      emitter.off('roof:enter', updatePreview)
      emitter.off('roof:click', onRoofClick)
      emitter.off('roof:leave', clearTarget)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true
      clearRoofSurfacePlacementGuides()
      useScene.temporal.getState().resume()
    }
  }, [exitMoveMode, node])

  if (!(previewPos && previewSurfaceQuat)) return null

  return (
    <group position={previewPos}>
      <group rotation-y={previewYaw}>
        <group quaternion={previewSurfaceQuat}>
          <EyebrowVentPreview node={node} />
        </group>
      </group>
    </group>
  )
}
