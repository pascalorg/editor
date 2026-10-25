'use client'

import {
  type AnyNodeId,
  DownspoutNode,
  emitter,
  type GutterEvent,
  type GutterNode,
  generateId,
  type RoofNode,
  type RoofSegmentNode,
  resolveAutomaticDownspoutLength,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { Vector3 } from 'three'
import { computeEaveY } from '../gutter/eave-snap'
import { resolveGutterOutletById } from '../gutter/outlet-lookup'
import { RoofAttachmentFallbackPreview } from '../shared/roof-attachment-fallback-preview'
import { downspoutDefinition } from './definition'
import { downspoutCursorOffset, resolveDownspoutPlacement } from './placement'
import DownspoutPreview from './preview'
import { computeDownspoutRouting, type DownspoutRouting } from './routing'

type PreviewTarget = {
  roof: { position: [number, number, number]; rotation: number }
  length: number
  valid: boolean
  offset: number
  segment: { position: [number, number, number]; rotation: number; eaveY: number }
  gutter: { position: [number, number, number]; rotation: number }
  outlet: { x: number; y: number; z: number; bore: number }
  routing: DownspoutRouting | null
}

/**
 * Downspout placement tool. Hovering a gutter previews a downspout at
 * the cursor's position ALONG the gutter; clicking drills a NEW outlet
 * there (appended to the gutter's `outlets`) and drops a downspout
 * linked to it. So multiple downspouts on one gutter land where you
 * click instead of stacking on a single outlet.
 *
 * The cursor's along-length offset is read by projecting the world hit
 * into the gutter's registered mesh frame (worldToLocal → local X). A
 * throwaway gutter with a single `preview` outlet feeds the same outlet
 * lookup + routing the committed pipe uses, so the ghost matches.
 */
const _hit = new Vector3()

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

    // Cursor's offset along the gutter length, from the world hit.
    const cursorOffset = (gutter: GutterNode, world: [number, number, number]): number | null => {
      const obj = sceneRegistry.nodes.get(gutter.id as AnyNodeId)
      if (!obj) return null
      obj.updateWorldMatrix(true, false)
      const local = obj.worldToLocal(_hit.set(world[0], world[1], world[2]))
      return downspoutCursorOffset(gutter, local.x, local.z)
    }

    const computeTarget = (event: GutterEvent): PreviewTarget | null => {
      const gutter = event.node
      const segmentId = gutter.roofSegmentId as AnyNodeId | undefined
      if (!segmentId) return null
      const segment = useScene.getState().nodes[segmentId] as RoofSegmentNode | undefined
      if (!segment) return null
      const offset = cursorOffset(gutter, event.position)
      if (offset === null) return null

      const placement = resolveDownspoutPlacement(
        gutter,
        offset,
        isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        event.nativeEvent?.altKey === true,
      )
      if (!placement) return null
      const roof = segment.parentId
        ? (useScene.getState().nodes[segment.parentId as AnyNodeId] as RoofNode)
        : undefined

      // Throwaway single-outlet gutter at the cursor so the lookup +
      // routing produce the exact pose the commit will store.
      const ghost: GutterNode = {
        ...gutter,
        outlets: [{ id: 'preview', offset: placement.offset, diameter: placement.diameter }],
      }
      const outlet = resolveGutterOutletById(ghost, 'preview')
      if (!outlet) return null

      return {
        roof: { position: roof?.position ?? [0, 0, 0], rotation: roof?.rotation ?? 0 },
        length: resolveAutomaticDownspoutLength(
          useScene.getState().nodes,
          segment,
          ghost,
          placement.offset,
        ),
        valid: placement.valid,
        offset: placement.offset,
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
        routing: computeDownspoutRouting(ghost, segment, 'preview'),
      }
    }

    const updatePreview = (event: GutterEvent) => {
      const next = computeTarget(event)
      setTarget(next)
      if (next) {
        event.stopPropagation()
      }
    }

    const onClick = (event: GutterEvent) => {
      const gutter = event.node
      const segmentId = gutter.roofSegmentId as AnyNodeId | undefined
      if (!segmentId) return
      const segment = useScene.getState().nodes[segmentId] as RoofSegmentNode | undefined
      if (!segment) return
      const target = computeTarget(event)
      if (!target?.valid) return
      const offset = target.offset
      // Drill a new outlet at the clicked offset, then drop a downspout
      // linked to it. Both land in one undoable step.
      const outletId = generateId('outlet')
      const outlets = [...(gutter.outlets ?? []), { id: outletId, offset, diameter: 0.07 }]
      const state = useScene.getState()

      const outlet = resolveGutterOutletById({ ...gutter, outlets }, outletId)
      if (!outlet) return
      // Drop from the gutter outlet (at eaveY − size) down to segment Y = 0.
      const dropLength = target.length

      const downspout = DownspoutNode.parse({
        ...downspoutDefinition.defaults(),
        name: 'Downspout',
        gutterId: gutter.id,
        outletId,
        length: dropLength,
        lengthMode: 'to-ground',
        diameter: outlet.bore * 2,
      })
      state.applyNodeChanges({
        update: [{ id: gutter.id, data: { outlets } }],
        create: [{ node: downspout, parentId: segmentId }],
      })
      setTarget(null)
      state.dirtyNodes.add(segmentId)
      setSelection({ selectedIds: [downspout.id] })
      triggerSFX('sfx:item-place')
      event.stopPropagation()
    }

    const clear = () => setTarget(null)
    emitter.on('gutter:leave', clear)
    emitter.on('tool:cancel', clear)
    emitter.on('gutter:move', updatePreview)
    emitter.on('gutter:enter', updatePreview)
    emitter.on('gutter:click', onClick)

    return () => {
      emitter.off('gutter:leave', clear)
      emitter.off('tool:cancel', clear)
      emitter.off('gutter:move', updatePreview)
      emitter.off('gutter:enter', updatePreview)
      emitter.off('gutter:click', onClick)
    }
  }, [activeBuildingId, setSelection])

  return (
    <>
      <RoofAttachmentFallbackPreview
        activeBuildingId={activeBuildingId}
        ghost={<DownspoutPreview node={previewNode} invalid />}
        onInvalidTarget={() => setTarget(null)}
        validTarget="gutter"
      />
      {activeBuildingId && target && (
        <group position={target.roof.position} rotation-y={target.roof.rotation}>
          <group position={target.segment.position} rotation-y={target.segment.rotation}>
            <group
              position={[
                target.gutter.position[0],
                target.segment.eaveY,
                target.gutter.position[2],
              ]}
              rotation-y={target.gutter.rotation}
            >
              <group position={[target.outlet.x, target.outlet.y, target.outlet.z]}>
                <DownspoutPreview
                  node={previewNodeWithDefaults(previewNode, target)}
                  routing={target.routing}
                  invalid={!target.valid}
                />
              </group>
            </group>
          </group>
        </group>
      )}
    </>
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
    length: target.length,
  } as typeof base
}

export default DownspoutTool
