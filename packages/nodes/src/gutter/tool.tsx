'use client'

import {
  type AnyNodeId,
  emitter,
  GutterNode,
  type RoofEvent,
  type RoofNode,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { resolveRoofSegmentHit } from '../shared/roof-segment-hit'
import {
  clearRoofSurfacePlacementGuides,
  publishRoofSurfacePlacementGuides,
  roofSurfaceFootprintFromNode,
} from '../shared/roof-surface-placement-guides'
import { gutterDefinition } from './definition'
import { type EaveSnap, resolveEaveSnap } from './eave-snap'
import GutterPreview from './preview'

type PreviewTarget = {
  roof: { position: [number, number, number]; rotation: number }
  segment: { position: [number, number, number]; rotation: number }
  snap: EaveSnap
}

/**
 * Gutter placement tool. Cursor preview snaps to the OUTER eave — the
 * drip edge of the roof, NOT the wall line. The eave sits at
 * `Z = ±(depth/2 + overhang)` in segment-local frame; the gutter
 * mounts against the fascia there, hanging outward from the building.
 *
 * Which eave: `eave-snap.ts` picks the side closest to the cursor
 * (roof-type aware — 4-way for hip/flat, low side only for shed, ±Z
 * for the rest) and returns the segment-local snap pose. The same
 * snap drives the ghost AND the commit, so picking-up + putting-down
 * land at identical world coordinates.
 *
 * Ghost transform: we mount the GutterPreview under the exact same
 * chain the GutterRenderer applies — roof.position + roof.rotation →
 * segment.position + segment.rotation → snap.eave + snap.rotation.
 * No `worldToBuildingLocal` + `previewYaw`-sum shortcut: that
 * collapses three Y rotations into one scalar and converts world
 * coords back into building-local, which is mathematically
 * equivalent for pure-Y stacks but drifts under any future non-Y
 * roof/segment transform. Sharing the renderer's chain means the
 * ghost and the placed mesh are guaranteed pixel-identical.
 */
const GutterTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  const [target, setTarget] = useState<PreviewTarget | null>(null)
  const lastSnapRef = useRef<[number, number] | null>(null)

  const previewNode = useMemo(
    () =>
      GutterNode.parse({
        ...gutterDefinition.defaults(),
        name: 'Gutter',
        position: [0, 0, 0],
        rotation: 0,
      }),
    [],
  )

  useEffect(() => {
    if (!activeBuildingId) return

    const updatePreview = (event: RoofEvent) => {
      const roof = event.node as RoofNode
      const hit = resolveRoofSegmentHit(
        roof,
        event.position[0],
        event.position[1],
        event.position[2],
      )
      if (!hit) return

      const snap = resolveEaveSnap(hit.segment, hit.localX, hit.localZ)

      // Grid-snap chime fires when the segment-local snap moves to a
      // new 5 cm cell along the eave — keeps SFX in lockstep with what
      // the commit will actually store.
      const sx = Math.round(snap.eaveX * 20) / 20
      const sz = Math.round(snap.eaveZ * 20) / 20
      const prev = lastSnapRef.current
      if (event.nativeEvent?.shiftKey !== true && (!prev || prev[0] !== sx || prev[1] !== sz)) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      setTarget({
        roof: {
          position: (roof.position ?? [0, 0, 0]) as [number, number, number],
          rotation: roof.rotation ?? 0,
        },
        segment: {
          position: (hit.segment.position ?? [0, 0, 0]) as [number, number, number],
          rotation: hit.segment.rotation ?? 0,
        },
        snap,
      })
      publishRoofSurfacePlacementGuides({
        roof,
        segment: hit.segment,
        center: [snap.eaveX, snap.eaveY, snap.eaveZ],
        footprint: roofSurfaceFootprintFromNode({ ...previewNode, rotation: snap.rotation }),
        mode: 'linear-edge',
      })
      event.stopPropagation()
    }

    const onClick = (event: RoofEvent) => {
      const hit = resolveRoofSegmentHit(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
      )
      if (!hit) return
      const state = useScene.getState()
      const snap = resolveEaveSnap(hit.segment, hit.localX, hit.localZ)

      const gutter = GutterNode.parse({
        ...gutterDefinition.defaults(),
        name: 'Gutter',
        roofSegmentId: hit.segment.id,
        // (X, Y, Z) all come from the eave snap — on ±Z eaves X stays
        // free along the cursor; on ±X eaves Z stays free instead.
        // Rotation orients the gutter's outward axis away from the
        // building on whichever side the click landed.
        position: [snap.eaveX, snap.eaveY, snap.eaveZ],
        rotation: snap.rotation,
      })
      state.createNode(gutter, hit.segment.id as AnyNodeId)
      state.dirtyNodes.add(hit.segment.id as AnyNodeId)
      setSelection({ selectedIds: [gutter.id] })
      triggerSFX('sfx:item-place')
      clearRoofSurfacePlacementGuides()
      event.stopPropagation()
    }

    emitter.on('roof:move', updatePreview)
    emitter.on('roof:enter', updatePreview)
    emitter.on('roof:click', onClick)

    return () => {
      emitter.off('roof:move', updatePreview)
      emitter.off('roof:enter', updatePreview)
      emitter.off('roof:click', onClick)
      clearRoofSurfacePlacementGuides()
    }
  }, [activeBuildingId, setSelection, previewNode])

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<GutterPreview node={previewNode} invalid />}
        onInvalidTarget={() => {
          setTarget(null)
          clearRoofSurfacePlacementGuides()
        }}
      />
      {activeBuildingId && target && (
        <group position={target.roof.position} rotation-y={target.roof.rotation}>
          <group position={target.segment.position} rotation-y={target.segment.rotation}>
            <group
              position={[target.snap.eaveX, target.snap.eaveY, target.snap.eaveZ]}
              rotation-y={target.snap.rotation}
            >
              <GutterPreview node={previewNode} />
            </group>
          </group>
        </group>
      )}
    </>
  )
}

export default GutterTool
