'use client'

import {
  type AnyNodeId,
  DownspoutNode,
  emitter,
  type GutterEvent,
  type RoofSegmentNode,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { computeEaveY } from '../gutter/eave-snap'
import { resolveGutterOutletPlacement } from '../gutter/outlet-lookup'
import { downspoutDefinition } from './definition'
import DownspoutPreview from './preview'

type PreviewTarget = {
  segment: { position: [number, number, number]; rotation: number; eaveY: number }
  gutter: { position: [number, number, number]; rotation: number }
  outlet: { x: number; y: number; z: number; bore: number }
}

/**
 * Downspout placement tool. Listens for `gutter:*` events and only
 * highlights gutters whose `outletSide` is enabled — a downspout
 * without an outlet is meaningless, so the user is gated to set the
 * outlet on the gutter first.
 *
 * On click, the new downspout is parented (scene-graph) to the same
 * roof-segment that hosts the gutter — that's the same lookup roof
 * accessories already do, so the downspout naturally renders under
 * the segment's `roof-elements` group alongside the gutter.
 *
 * Length defaults to the eave-Y at click time, so the pipe drops to
 * Y = 0 (segment-local ground plane) without the user having to set
 * it. They can tweak the length in the inspector afterward.
 */
const DownspoutTool = () => {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)

  const [target, setTarget] = useState<PreviewTarget | null>(null)

  const previewNode = useMemo(
    () =>
      DownspoutNode.parse({
        ...downspoutDefinition.defaults(),
        name: 'Downspout',
      }),
    [],
  )

  useEffect(() => {
    if (!activeBuildingId) return

    const computeTarget = (event: GutterEvent): PreviewTarget | null => {
      const gutter = event.node
      const outlet = resolveGutterOutletPlacement(gutter)
      if (!outlet) return null
      const segmentId = gutter.roofSegmentId as AnyNodeId | undefined
      if (!segmentId) return null
      const segment = useScene.getState().nodes[segmentId] as RoofSegmentNode | undefined
      if (!segment) return null
      return {
        segment: {
          position: (segment.position ?? [0, 0, 0]) as [number, number, number],
          rotation: segment.rotation ?? 0,
          eaveY: computeEaveY(segment),
        },
        gutter: {
          position: (gutter.position ?? [0, 0, 0]) as [number, number, number],
          rotation: gutter.rotation ?? 0,
        },
        outlet,
      }
    }

    const updatePreview = (event: GutterEvent) => {
      const next = computeTarget(event)
      if (next) {
        setTarget(next)
        event.stopPropagation()
      }
    }

    const onClick = (event: GutterEvent) => {
      const gutter = event.node
      const outlet = resolveGutterOutletPlacement(gutter)
      if (!outlet) return
      const segmentId = gutter.roofSegmentId as AnyNodeId | undefined
      if (!segmentId) return
      const segment = useScene.getState().nodes[segmentId] as RoofSegmentNode | undefined
      if (!segment) return

      // Default length: drop from the gutter outlet down to the
      // segment's local Y = 0 plane. The outlet sits at
      // (eaveY + outlet.y) where outlet.y = −size. So the drop is
      // (eaveY − size).
      const dropLength = Math.max(0.1, computeEaveY(segment) + outlet.y)

      const downspout = DownspoutNode.parse({
        ...downspoutDefinition.defaults(),
        name: 'Downspout',
        gutterId: gutter.id,
        length: dropLength,
        diameter: outlet.bore * 2,
      })
      const state = useScene.getState()
      state.createNode(downspout, segmentId)
      state.dirtyNodes.add(segmentId)
      setSelection({ selectedIds: [downspout.id] })
      triggerSFX('sfx:item-place')
      event.stopPropagation()
    }

    emitter.on('gutter:move', updatePreview)
    emitter.on('gutter:enter', updatePreview)
    emitter.on('gutter:click', onClick)

    return () => {
      emitter.off('gutter:move', updatePreview)
      emitter.off('gutter:enter', updatePreview)
      emitter.off('gutter:click', onClick)
    }
  }, [activeBuildingId, setSelection])

  if (!activeBuildingId || !target) return null

  return (
    <group position={target.segment.position} rotation-y={target.segment.rotation}>
      <group
        position={[target.gutter.position[0], target.segment.eaveY, target.gutter.position[2]]}
        rotation-y={target.gutter.rotation}
      >
        <group position={[target.outlet.x, target.outlet.y, target.outlet.z]}>
          <DownspoutPreview node={previewNodeWithDefaults(previewNode, target)} />
        </group>
      </group>
    </group>
  )
}

function previewNodeWithDefaults(
  base: ReturnType<typeof DownspoutNode.parse>,
  target: PreviewTarget,
): typeof base {
  // Snap preview to the same dimensions a commit would use — bore
  // diameter from the gutter, drop length to the segment Y=0 plane.
  return {
    ...base,
    diameter: target.outlet.bore * 2,
    length: Math.max(0.1, target.segment.eaveY + target.outlet.y),
  } as typeof base
}

export default DownspoutTool