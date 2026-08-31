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
import {
  consumePlacementDragRelease,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useCallback, useEffect, useState } from 'react'
import { createRelativeRoofDrag, snapRelativeRoofDragTarget } from '../shared/relative-roof-drag'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfaceNodePlacementGuides,
} from '../shared/roof-surface-placement-guides'
import { type EaveSnap, resolveEaveSnap } from './eave-snap'
import GutterPreview from './preview'

type PreviewTarget = {
  roof: { position: [number, number, number]; rotation: number }
  segment: { position: [number, number, number]; rotation: number }
  snap: EaveSnap
}

type GutterDragTarget = {
  segment: RoofSegmentNode
  snap: EaveSnap
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
 *
 * Ghost transform: mirrors the GutterRenderer chain (roof → segment →
 * snap), so the cursor preview lands at the exact world coords the
 * commit will store. GutterPreview applies no internal rotation, so
 * the gutter's CURRENT `rotation` doesn't bleed into the new snap.
 */
export default function MoveGutterTool({ node }: { node: GutterNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const [target, setTarget] = useState<PreviewTarget | null>(null)

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

    let lastSnap: [number, number] | null = null
    let lastTarget: GutterDragTarget | null = null
    let committed = false
    const roofDrag = createRelativeRoofDrag(original)

    const clearTarget = () => {
      lastTarget = null
      lastSnap = null
      setTarget(null)
      clearRoofSurfacePlacementGuides()
    }

    const resolveTarget = (event: RoofEvent): GutterDragTarget | null => {
      const rawTarget = roofDrag.resolve(event)
      if (!rawTarget) return null
      const target = snapRelativeRoofDragTarget(rawTarget, event.nativeEvent?.shiftKey === true)
      return {
        segment: target.segment,
        snap: resolveEaveSnap(target.segment, target.localX, target.localZ),
      }
    }

    const updatePreview = (event: RoofEvent) => {
      const roof = event.node as RoofNode
      const target = resolveTarget(event)
      if (!target) {
        clearTarget()
        return
      }
      lastTarget = target

      // Same snap math as the placement tool — picking-up and putting-
      // down round-trip identically. roofType-aware: hip/flat picks
      // ±X or ±Z based on which slope the cursor is on; shed always
      // snaps to its low (+Z) eave; gable / gambrel / mansard / dutch
      // stay on ±Z.
      const { snap } = target

      const sx = Math.round(snap.eaveX * 20) / 20
      const sz = Math.round(snap.eaveZ * 20) / 20
      if (
        event.nativeEvent?.shiftKey !== true &&
        (!lastSnap || lastSnap[0] !== sx || lastSnap[1] !== sz)
      ) {
        triggerSFX('sfx:grid-snap')
        lastSnap = [sx, sz]
      }

      setTarget({
        roof: {
          position: (roof.position ?? [0, 0, 0]) as [number, number, number],
          rotation: roof.rotation ?? 0,
        },
        segment: {
          position: (target.segment.position ?? [0, 0, 0]) as [number, number, number],
          rotation: target.segment.rotation ?? 0,
        },
        snap,
      })
      publishRoofSurfaceNodePlacementGuides({
        roof,
        segment: target.segment,
        center: [snap.eaveX, snap.eaveY, snap.eaveZ],
        node: { ...node, rotation: snap.rotation },
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
      const { snap } = target
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
        position: [snap.eaveX, snap.eaveY, snap.eaveZ],
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

  if (!target) return null

  return (
    <group position={target.roof.position} rotation-y={target.roof.rotation}>
      <group position={target.segment.position} rotation-y={target.segment.rotation}>
        <group
          position={[target.snap.eaveX, target.snap.eaveY, target.snap.eaveZ]}
          rotation-y={target.snap.rotation}
        >
          <GutterPreview node={node} />
        </group>
      </group>
    </group>
  )
}
