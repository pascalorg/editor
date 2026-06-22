'use client'

import {
  type AnyNodeId,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  type SolarPanelNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  consumePlacementDragRelease,
  EDITOR_LAYER,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

// MeshBasicMaterial: avoids the WebGPU "Color target has no corresponding
// fragment stage output / writeMask not zero" error that fires when
// MeshStandardMaterial (which writes to the MRT normal/roughness targets)
// is rendered in a pass whose render target lacks those attachments.
// Same fix as skylight's glass material. Visually identical for a ghost.
const previewMaterial = new THREE.MeshBasicMaterial({
  color: 0x22_44_88,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
})

export default function MoveSolarPanelTool({ node }: { node: SolarPanelNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previewRef = useRef<THREE.Group>(null!)
  const [previewPos, setPreviewPos] = useState<[number, number, number]>([0, 0, 0])
  // Yaw = roof.rotation + segment.rotation; applied as outer rotation-y
  // so the surface quat (segment-local) composes correctly — same pattern
  // as the placement tool ghost.
  const [previewYaw, setPreviewYaw] = useState(0)
  const [previewSurfaceQuat, setPreviewSurfaceQuat] = useState<THREE.Quaternion>(
    new THREE.Quaternion(),
  )
  const [hasHit, setHasHit] = useState(false)

  // Compact 2×3 ghost — same size as the placement tool ghost.
  const previewGeo = useMemo(() => {
    const ghostRows = 2
    const ghostCols = 3
    const totalW = ghostCols * node.panelWidth + (ghostCols - 1) * node.gapX
    const totalH = ghostRows * node.panelHeight + (ghostRows - 1) * node.gapY
    const geo = new THREE.BoxGeometry(totalW, node.frameDepth, totalH)
    geo.translate(0, node.standoffHeight + node.frameDepth / 2, 0)
    return geo
  }, [
    node.panelWidth,
    node.panelHeight,
    node.gapX,
    node.gapY,
    node.frameDepth,
    node.standoffHeight,
  ])

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

    const panelObj = sceneRegistry.nodes.get(node.id)
    if (panelObj) panelObj.visible = false

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

    const updateGhost = (event: RoofEvent) => {
      const target = resolveSnappedTarget(event)
      if (!target) {
        clearTarget()
        return
      }
      lastTarget = target

      const sx = Math.round(target.localX * 20) / 20
      const sz = Math.round(target.localZ * 20) / 20
      if (event.nativeEvent?.shiftKey !== true && (sx !== lastSnapX || sz !== lastSnapZ)) {
        triggerSFX('sfx:grid-snap')
        lastSnapX = sx
        lastSnapZ = sz
      }

      // Use the same analytical approach as the placement tool so the
      // ghost orientation matches the committed panel exactly regardless
      // of segment rotation. The placement tool's ghost is always correct
      // because analytical normals are computed in segment-local space
      // and the yaw is applied explicitly, avoiding any world-vs-local
      // normal mismatch.
      const segLocalNormal = getAnalyticalNormal(target.localX, target.localZ, target.segment)
      setPreviewSurfaceQuat(surfaceQuatFromNormal(segLocalNormal, new THREE.Quaternion()))
      setPreviewYaw((event.node.rotation ?? 0) + (target.segment.rotation ?? 0))
      setPreviewPos(
        roofSegmentLocalToBuildingLocal(target.segment.id, [
          target.localX,
          target.localY,
          target.localZ,
        ]),
      )
      setHasHit(true)
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
      const st = useScene.getState()

      const target = lastTarget ?? resolveSnappedTarget(event)
      if (!target) return
      committed = true

      const targetSegmentId = target.segment.id as AnyNodeId

      // Compute segment-local normal for the committed node so the
      // renderer's surfaceQuat + outer segment.rotation compose to
      // the same world orientation the ghost showed.
      const segLocalNormal = getAnalyticalNormal(target.localX, target.localZ, target.segment)

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
        rotation: original.rotation,
        // Segment-local normal — must stay consistent with getAnalyticalNormal
        // semantics so the renderer's surfaceQuat is in the correct frame.
        surfaceNormal: [segLocalNormal.x, segLocalNormal.y, segLocalNormal.z],
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

    emitter.on('roof:move', updateGhost)
    emitter.on('roof:enter', updateGhost)
    emitter.on('roof:click', onRoofClick)
    emitter.on('roof:leave', clearTarget)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      emitter.off('roof:move', updateGhost)
      emitter.off('roof:enter', updateGhost)
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

  // Ghost layout mirrors the placement tool exactly:
  //   position (building-local hit point)
  //   → rotation-y (roof.rotation + segment.rotation — explicit yaw)
  //   → quaternion (segment-local surface tilt)
  // This is identical to the placement ghost so drag and commit always
  // show the same orientation.
  return (
    <group position={previewPos} ref={previewRef} visible={hasHit}>
      <group rotation-y={previewYaw}>
        <group quaternion={previewSurfaceQuat}>
          <mesh geometry={previewGeo} layers={EDITOR_LAYER} material={previewMaterial} />
        </group>
      </group>
    </group>
  )
}
