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
import {
  consumePlacementDragRelease,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useCallback, useEffect, useState } from 'react'
import {
  createRelativeRoofDrag,
  type RelativeRoofDragTarget,
  roofSegmentLocalToBuildingLocal,
  snapRelativeRoofDragTarget,
} from '../shared/relative-roof-drag'
import { resolveRidgeSnap } from '../shared/ridge-snap'
import { getRoofTopSurfaceY } from '../shared/roof-surface'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfaceNodePlacementGuides,
} from '../shared/roof-surface-placement-guides'
import RidgeVentPreview from './preview'

type RidgeVentDragTarget = Pick<RelativeRoofDragTarget, 'segment' | 'localX'> & {
  localY: number
  localZ: number
  rotation: number
}

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

    let lastSnap: [number, number] | null = null
    let lastTarget: RidgeVentDragTarget | null = null
    let committed = false
    const roofDrag = createRelativeRoofDrag(original)

    const clearTarget = () => {
      lastTarget = null
      lastSnap = null
      setPreviewPos(null)
      clearRoofSurfacePlacementGuides()
    }

    const resolveTarget = (event: RoofEvent): RidgeVentDragTarget | null => {
      const rawTarget = roofDrag.resolve(event)
      if (!rawTarget) return null
      const target = snapRelativeRoofDragTarget(rawTarget, event.nativeEvent?.shiftKey === true)
      const snap = resolveRidgeSnap(target.segment, target.localX, target.localZ)
      if (!snap) return null
      const yOffset = original.position[1] ?? 0
      return {
        segment: target.segment,
        localX: snap.localX,
        localY: getRoofTopSurfaceY(snap.localX, snap.localZ, target.segment) + yOffset,
        localZ: snap.localZ,
        rotation: snap.rotation,
      }
    }

    const updatePreview = (event: RoofEvent) => {
      const target = resolveTarget(event)
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

      setPreviewYaw((event.node.rotation ?? 0) + (target.segment.rotation ?? 0) + target.rotation)
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
        mode: 'linear-edge',
      })
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      if (committed) return
      const target = lastTarget ?? resolveTarget(event)
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
        position: [target.localX, original.position[1] ?? 0, target.localZ],
        rotation: target.rotation,
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

  if (!previewPos) return null

  return (
    <group position={previewPos}>
      <group rotation-y={previewYaw}>
        <RidgeVentPreview node={node} />
      </group>
    </group>
  )
}
