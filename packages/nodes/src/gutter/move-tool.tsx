'use client'

import {
  type AnyNodeId,
  emitter,
  type GutterNode,
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
import GutterPreview from './preview'

// Keep these in sync with the placement tool (`./tool.tsx`). Real
// gutters mount on the fascia (slightly inside the drip edge) with
// the rim at the deck-top line; the offsets nudge the bare-slope snap
// to read as "attached to fascia" rather than "floating at the very
// tip of the overhang".
const EAVE_TUCK_INWARD = 0.04
const EAVE_TUCK_UP = 0.04

function resolveEaveSnap(segment: RoofSegmentNode, localZ: number) {
  const halfD = (segment.depth ?? 0) / 2
  const overhang = segment.overhang ?? 0
  const pitchRad = ((segment.pitch ?? 0) * Math.PI) / 180
  const sign = localZ < 0 ? -1 : 1
  const eaveZ = sign * Math.max(halfD, halfD + overhang - EAVE_TUCK_INWARD)
  const eaveY = (segment.wallHeight ?? 0) - overhang * Math.tan(pitchRad) + EAVE_TUCK_UP
  const rotation = sign > 0 ? 0 : Math.PI
  return { eaveZ, eaveY, rotation }
}

/**
 * Gutter move tool. Mirrors the ridge-vent move flow — ghost follows
 * the cursor over any roof segment, click commits the new position +
 * parent segment in one undoable step. The eave-snap math from the
 * placement tool runs again on the new segment so the gutter lands on
 * the correct side of the new ridge.
 *
 * On commit the gutter rotation may flip from 0 ↔ π if the user moves
 * it from the front eave to the back eave (or vice versa). The
 * pre-drag rotation is restored on cancel.
 */
export default function MoveGutterTool({ node }: { node: GutterNode }) {
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

    const gutterObj = sceneRegistry.nodes.get(node.id)
    if (gutterObj) gutterObj.visible = false

    const worldToBuildingLocal = (
      wx: number,
      wy: number,
      wz: number,
    ): [number, number, number] => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      if (!buildingObj) return [wx, wy, wz]
      const v = new THREE.Vector3(wx, wy, wz)
      buildingObj.worldToLocal(v)
      return [v.x, v.y, v.z]
    }

    let lastSnap: [number, number] | null = null

    const updatePreview = (event: RoofEvent) => {
      const hit = resolveRoofSegmentHit(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
      )
      if (!hit) return

      // Eave-snap to the segment's near drip edge — same math as the
      // placement tool so picking-up + putting-down lands in the
      // same place.
      const snap = resolveEaveSnap(hit.segment, hit.localZ)
      const segObj = sceneRegistry.nodes.get(hit.segment.id)
      let eaveWorld: [number, number, number]
      if (segObj) {
        const eaveLocal = new THREE.Vector3(hit.localX, snap.eaveY, snap.eaveZ)
        segObj.updateWorldMatrix(true, false)
        eaveLocal.applyMatrix4(segObj.matrixWorld)
        eaveWorld = [eaveLocal.x, eaveLocal.y, eaveLocal.z]
      } else {
        eaveWorld = [event.position[0], event.position[1], event.position[2]]
      }

      const sx = Math.round(eaveWorld[0] * 20) / 20
      const sz = Math.round(eaveWorld[2] * 20) / 20
      if (!lastSnap || lastSnap[0] !== sx || lastSnap[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        lastSnap = [sx, sz]
      }

      setPreviewYaw((event.node.rotation ?? 0) + (hit.segment.rotation ?? 0) + snap.rotation)
      setPreviewPos(worldToBuildingLocal(eaveWorld[0], eaveWorld[1], eaveWorld[2]))
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
      const snap = resolveEaveSnap(hit.segment, hit.localZ)
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
        position: [hit.localX, snap.eaveY, snap.eaveZ],
        rotation: snap.rotation,
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
        <GutterPreview node={node} />
      </group>
    </group>
  )
}
