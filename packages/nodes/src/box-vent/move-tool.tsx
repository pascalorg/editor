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
import {
  commitFreshPlacementSubtree,
  consumePlacementDragRelease,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  stripPlacementMetadataFlags,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { useCallback, useEffect, useState } from 'react'
import * as THREE from 'three'
import {
  createRelativeRoofDrag,
  type RelativeRoofDragTarget,
  roofSegmentLocalToBuildingLocal,
} from '../shared/relative-roof-drag'
import { surfaceQuatFromNormal } from '../shared/roof-surface'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfaceNodePlacementGuides,
  snapRoofSurfaceNodeTarget,
} from '../shared/roof-surface-placement-guides'
import { resolveBoxVentPlacement } from './placement'
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
  const [previewValid, setPreviewValid] = useState(true)
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
    let forcePlacement = false
    const originalSegment = original.roofSegmentId
      ? (useScene.getState().nodes[original.roofSegmentId as AnyNodeId] as RoofSegmentNode)
      : undefined
    const roofOffset = originalSegment
      ? original.position[1] -
        getRoofOuterSurfaceFrameAtPoint(originalSegment, original.position[0], original.position[2])
          .point.y
      : 0
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
      forcePlacement = event.nativeEvent?.altKey === true
      let placement = resolveBoxVentPlacement(
        rawTarget.segment,
        node,
        rawTarget.localX,
        rawTarget.localZ,
        {
          roofOffset,
          gridStep: !forcePlacement && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        },
      )
      let target = {
        ...rawTarget,
        localX: placement.position[0],
        localY: placement.position[1],
        localZ: placement.position[2],
      }
      if (!forcePlacement && isMagneticSnapActive()) {
        target = snapRoofSurfaceNodeTarget({ target, node })
        placement = resolveBoxVentPlacement(target.segment, node, target.localX, target.localZ, {
          roofOffset,
        })
        target = { ...target, localY: placement.position[1] }
      }
      setPreviewValid(placement.valid || forcePlacement)
      return target
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
        !forcePlacement &&
        (isGridSnapActive() || isMagneticSnapActive()) &&
        (!lastSnap || lastSnap[0] !== sx || lastSnap[1] !== sz)
      ) {
        triggerSFX('sfx:grid-snap')
        lastSnap = [sx, sz]
      }

      const normal = getRoofOuterSurfaceFrameAtPoint(
        target.segment,
        target.localX,
        target.localZ,
      ).normal
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
      const target = event.node ? resolveSnappedTarget(event) : lastTarget
      if (!target) return
      if (
        !forcePlacement &&
        !resolveBoxVentPlacement(target.segment, node, target.localX, target.localZ, { roofOffset })
          .valid
      )
        return
      committed = true
      const targetSegmentId = target.segment.id as AnyNodeId
      const st = useScene.getState()

      const patch = {
        roofSegmentId: targetSegmentId,
        parentId: targetSegmentId,
        position: [target.localX, target.localY, target.localZ] as [number, number, number],
        rotation: original.rotation,
        visible: true,
        metadata: stripPlacementMetadataFlags(original.metadata) as BoxVentNode['metadata'],
      }
      if (isNew) {
        commitFreshPlacementSubtree(node.id as AnyNodeId, patch)
      } else {
        useScene.temporal.getState().resume()
        st.updateNode(node.id as AnyNodeId, patch)
        useScene.temporal.getState().pause()
      }

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

      // Safety restore — if the tool is unmounted by something other than
      // a commit / cancel path (e.g. tool change, selection wipe), leave
      // the original mesh visible rather than stranded invisible.
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
          <BoxVentPreview node={node} invalid={!previewValid} />
        </group>
      </group>
    </group>
  )
}
