'use client'

import {
  type AnyNodeId,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  type SkylightNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  consumePlacementDragRelease,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import SkylightPreview from './preview'

export default function MoveSkylightTool({ node }: { node: SkylightNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previewRef = useRef<THREE.Group>(null!)
  const [previewPos, setPreviewPos] = useState<[number, number, number]>([0, 0, 0])
  // Mirror the placement tool's transform stack so the ghost reads the
  // same in both flows: outer rotation-y aligns the segment's world yaw
  // (roof + segment), inner quaternion tilts to the segment surface in
  // segment-local space (analytical, not raycast — raycast normals can
  // be flipped or in the wrong frame depending on hit-object state).
  // The skylight's own `rotation` is applied on a deeper group so it
  // stays editable on top of the surface alignment.
  const [previewYaw, setPreviewYaw] = useState(0)
  const [previewSurfaceQuat, setPreviewSurfaceQuat] = useState<THREE.Quaternion | null>(null)
  const [hasHit, setHasHit] = useState(false)

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
    useScene.getState().updateNode(node.id as AnyNodeId, {
      metadata: { ...meta, isTransient: true },
    })

    const skylightObj = sceneRegistry.nodes.get(node.id)
    if (skylightObj) skylightObj.visible = false

    let lastSnapX = 0
    let lastSnapZ = 0
    let lastTarget: RelativeRoofDragTarget | null = null
    let committed = false
    const roofDrag = createRelativeRoofDrag(original)

    const clearTarget = () => {
      lastTarget = null
      setHasHit(false)
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

    // Resolve which segment the cursor is over, then derive the same
    // preview transform stack the placement tool uses (`skylight/tool.tsx`):
    // analytical surface normal in segment-local frame → outer yaw =
    // roof + segment rotation. Falls back to leaving the preview hidden
    // if the cursor is between segments — the placement tool does the
    // same via its `if (!hit) return` guard.
    const updateFromHit = (event: RoofEvent) => {
      const roof = event.node as RoofNode
      const target = resolveSnappedTarget(event)
      if (!target) {
        clearTarget()
        return false
      }
      lastTarget = target
      const normal = getAnalyticalNormal(target.localX, target.localZ, target.segment)
      setPreviewSurfaceQuat(surfaceQuatFromNormal(normal, new THREE.Quaternion()))
      setPreviewYaw((roof.rotation ?? 0) + (target.segment.rotation ?? 0))
      setPreviewPos(
        roofSegmentLocalToBuildingLocal(target.segment.id, [
          target.localX,
          target.localY,
          target.localZ,
        ]),
      )
      setHasHit(true)
      publishRoofSurfaceNodePlacementGuides({
        roof,
        segment: target.segment,
        center: [target.localX, target.localY, target.localZ],
        node,
      })
      return true
    }

    const onRoofMove = (event: RoofEvent) => {
      const sx = Math.round(event.position[0] * 20) / 20
      const sz = Math.round(event.position[2] * 20) / 20
      if (event.nativeEvent?.shiftKey !== true && (sx !== lastSnapX || sz !== lastSnapZ)) {
        triggerSFX('sfx:grid-snap')
        lastSnapX = sx
        lastSnapZ = sz
      }
      updateFromHit(event)
      event.stopPropagation()
    }

    const onRoofEnter = (event: RoofEvent) => {
      updateFromHit(event)
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      if (committed) return
      const st = useScene.getState()

      const target = lastTarget ?? resolveSnappedTarget(event)
      if (!target) return
      committed = true

      const targetSegmentId = target.segment.id as AnyNodeId
      const finalRotation = original.rotation

      st.updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })
      useScene.temporal.getState().resume()

      st.updateNode(node.id as AnyNodeId, {
        roofSegmentId: targetSegmentId,
        parentId: targetSegmentId,
        position: [target.localX, target.localY, target.localZ],
        rotation: finalRotation,
        visible: true,
        metadata: {},
      })

      if (original.roofSegmentId && original.roofSegmentId !== (targetSegmentId as string)) {
        const oldSeg = st.nodes[original.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (oldSeg) {
          st.updateNode(original.roofSegmentId as AnyNodeId, {
            children: (oldSeg.children ?? []).filter((id) => id !== node.id),
          })
        }
        const newSeg = st.nodes[targetSegmentId] as RoofSegmentNode | undefined
        if (newSeg && !(newSeg.children ?? []).includes(node.id)) {
          st.updateNode(targetSegmentId, {
            children: [...(newSeg.children ?? []), node.id],
          })
        }
        st.dirtyNodes.add(original.roofSegmentId as AnyNodeId)
      }
      st.dirtyNodes.add(targetSegmentId)
      st.dirtyNodes.add(node.id as AnyNodeId)

      useScene.temporal.getState().pause()

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true

      triggerSFX('sfx:item-place')
      clearRoofSurfacePlacementGuides()
      exitMoveMode()
      event.stopPropagation()
    }

    const onCancel = () => {
      if (isNew) {
        useScene.temporal.getState().resume()
        const parentId = original.roofSegmentId
        if (parentId) {
          const parent = useScene.getState().nodes[parentId as AnyNodeId] as
            | RoofSegmentNode
            | undefined
          if (parent) {
            useScene.getState().updateNode(parentId as AnyNodeId, {
              children: (parent.children ?? []).filter((id) => id !== node.id),
            })
          }
        }
        useScene.getState().deleteNode(node.id as AnyNodeId)
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

    emitter.on('roof:move', onRoofMove)
    emitter.on('roof:enter', onRoofEnter)
    emitter.on('roof:click', onRoofClick)
    emitter.on('roof:leave', clearTarget)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      emitter.off('roof:move', onRoofMove)
      emitter.off('roof:enter', onRoofEnter)
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

  if (!previewSurfaceQuat) return null

  return (
    <group position={previewPos} ref={previewRef} visible={hasHit}>
      <group rotation-y={previewYaw}>
        <group quaternion={previewSurfaceQuat}>
          <group rotation-y={node.rotation ?? 0}>
            <SkylightPreview node={node} />
          </group>
        </group>
      </group>
    </group>
  )
}
