'use client'

import {
  type AnyNodeId,
  emitter,
  RidgeVentNode,
  type RoofEvent,
  type RoofSegmentNode,
} from '@pascal-app/core'
import {
  isGridSnapActive,
  triggerSFX,
  useEditor,
  usePlacementPreview,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { roofSegmentLocalToBuildingLocal } from '../shared/relative-roof-drag'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { resolveRoofSegmentHit } from '../shared/roof-segment-hit'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfaceNodePlacementGuides,
} from '../shared/roof-surface-placement-guides'
import { ridgeVentDefinition } from './definition'
import { resolveRidgeVentPlacement } from './placement'
import RidgeVentPreview from './preview'

export default function RidgeVentTool() {
  const { sceneApi } = useRegistryToolContext()
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const seed = useMemo(
    () => RidgeVentNode.parse({ ...ridgeVentDefinition.defaults(), name: 'Ridge Vent' }),
    [],
  )
  const [preview, setPreview] = useState<{
    node: RidgeVentNode
    position: [number, number, number]
    segment: RoofSegmentNode
    yaw: number
    valid: boolean
  } | null>(null)

  useEffect(() => {
    if (!activeBuildingId) return
    const clear = () => {
      setPreview(null)
      if (usePlacementPreview.getState().node?.id === seed.id)
        usePlacementPreview.getState().clear()
      clearRoofSurfacePlacementGuides()
    }
    const resolve = (event: RoofEvent) => {
      const hit = resolveRoofSegmentHit(event.node, ...event.position)
      if (!hit) return null
      const force = event.nativeEvent?.altKey === true
      const placement = resolveRidgeVentPlacement(hit.segment, seed, hit.localX, hit.localZ, {
        gridStep: !force && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        free: force,
      })
      if (!placement) return null
      return { hit, placement, force }
    }
    const show = (event: RoofEvent) => {
      const resolved = resolve(event)
      if (!resolved) {
        clear()
        return
      }
      const { hit, placement, force } = resolved
      const node = {
        ...seed,
        position: placement.position,
        rotation: placement.rotation,
        parentId: hit.segment.id,
        roofSegmentId: hit.segment.id,
      }
      setPreview({
        node,
        position: roofSegmentLocalToBuildingLocal(hit.segment.id, [
          placement.position[0],
          placement.surfaceY,
          placement.position[2],
        ]),
        segment: hit.segment,
        yaw: event.node.rotation + hit.segment.rotation,
        valid: placement.valid || force,
      })
      usePlacementPreview.getState().set(node, hit.segment)
      publishRoofSurfaceNodePlacementGuides({
        roof: event.node,
        segment: hit.segment,
        center: [placement.position[0], placement.surfaceY, placement.position[2]],
        node,
      })
      event.stopPropagation()
    }
    const place = (event: RoofEvent) => {
      const resolved = resolve(event)
      if (!resolved) return
      const { hit, placement, force } = resolved
      if (!placement.valid && !force) {
        show(event)
        return
      }
      const node = RidgeVentNode.parse({
        ...seed,
        id: undefined,
        roofSegmentId: hit.segment.id,
        position: placement.position,
        rotation: placement.rotation,
      })
      sceneApi.upsert(node, hit.segment.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      triggerSFX('sfx:item-place')
      clear()
      event.stopPropagation()
    }
    emitter.on('roof:move', show)
    emitter.on('roof:enter', show)
    emitter.on('roof:leave', clear)
    emitter.on('roof:click', place)
    emitter.on('tool:cancel', clear)
    return () => {
      emitter.off('roof:move', show)
      emitter.off('roof:enter', show)
      emitter.off('roof:leave', clear)
      emitter.off('roof:click', place)
      emitter.off('tool:cancel', clear)
      clear()
    }
  }, [activeBuildingId, seed, sceneApi])

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<RidgeVentPreview node={seed} invalid />}
        onInvalidTarget={() => {
          setPreview(null)
          usePlacementPreview.getState().clear()
          clearRoofSurfacePlacementGuides()
        }}
      />
      {preview && (
        <group position={preview.position}>
          <group rotation-y={preview.yaw}>
            <RidgeVentPreview
              node={preview.node}
              segment={preview.segment}
              invalid={!preview.valid}
            />
          </group>
        </group>
      )}
    </>
  )
}
