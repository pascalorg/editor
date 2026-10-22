'use client'

import { type AnyNodeId, emitter, type RoofEvent, SolarPanelNode, useScene } from '@pascal-app/core'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { getRoofOuterSurfaceFrameAtPoint, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { roofSegmentLocalToBuildingLocal } from '../shared/relative-roof-drag'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { resolveRoofSegmentHit } from '../shared/roof-segment-hit'
import { surfaceQuatFromNormal } from '../shared/roof-surface'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfaceNodePlacementGuides,
  snapRoofSurfaceNodeTarget,
} from '../shared/roof-surface-placement-guides'
import { solarPanelObstacles } from './auto-fit'
import { solarPanelDefinition } from './definition'
import { resolveSolarPanelPlacement } from './placement'
import SolarPanelPreview from './preview'

export default function SolarPanelTool() {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const seed = useMemo(
    () => SolarPanelNode.parse({ ...solarPanelDefinition.defaults(), name: 'Solar Panel' }),
    [],
  )
  const [preview, setPreview] = useState<{
    node: SolarPanelNode
    position: [number, number, number]
    normal: THREE.Quaternion
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
      let placement = resolveSolarPanelPlacement(hit.segment, seed, hit.localX, hit.localZ, {
        obstacles: solarPanelObstacles(hit.segment, seed, Object.values(useScene.getState().nodes)),
        gridStep: !force && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
      })
      if (!force && isMagneticSnapActive()) {
        const target = snapRoofSurfaceNodeTarget({
          target: {
            ...hit,
            hit,
            localX: placement.position[0],
            localY: placement.position[1],
            localZ: placement.position[2],
          },
          node: { ...seed, rotation: placement.rotation },
        })
        placement = resolveSolarPanelPlacement(hit.segment, seed, target.localX, target.localZ, {
          obstacles: solarPanelObstacles(
            hit.segment,
            seed,
            Object.values(useScene.getState().nodes),
          ),
        })
      }
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
      const normal = getRoofOuterSurfaceFrameAtPoint(
        hit.segment,
        placement.position[0],
        placement.position[2],
      ).normal
      setPreview({
        node,
        position: roofSegmentLocalToBuildingLocal(hit.segment.id, placement.position),
        normal: surfaceQuatFromNormal(normal, new THREE.Quaternion()),
        yaw: event.node.rotation + hit.segment.rotation,
        valid: placement.valid || force,
      })
      usePlacementPreview.getState().set(node, hit.segment)
      publishRoofSurfaceNodePlacementGuides({
        roof: event.node,
        segment: hit.segment,
        center: placement.position,
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
      const node = SolarPanelNode.parse({
        ...seed,
        id: undefined,
        roofSegmentId: hit.segment.id,
        position: placement.position,
        rotation: placement.rotation,
      })
      useScene.getState().createNode(node, hit.segment.id as AnyNodeId)
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
  }, [activeBuildingId, seed])

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<SolarPanelPreview node={seed} invalid />}
        onInvalidTarget={() => {
          setPreview(null)
          usePlacementPreview.getState().clear()
          clearRoofSurfacePlacementGuides()
        }}
      />
      {preview && (
        <group position={preview.position}>
          <group rotation-y={preview.yaw}>
            <group quaternion={preview.normal}>
              <SolarPanelPreview node={preview.node} invalid={!preview.valid} />
            </group>
          </group>
        </group>
      )}
    </>
  )
}
