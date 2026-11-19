'use client'

import { emitter, type GridEvent, resolveSiteGround, usePascalI18n } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useState } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { GardenToolTarget } from '../shared/garden-draft-preview'
import { siteFrame } from '../shared/site-frame'
import { ownsTreePlacement, placeTree, snapTreePlacementPoint } from './placement'
import { treePlacementMessage } from './placement-message'
import { useTreePlacementScope } from './placement-scope'

type PlacementRefusal = { code: string; at: [number, number] }
type Point = [number, number]

function useTreePlacementInput(
  context: ReturnType<typeof useRegistryToolContext>,
  onRefusal: (refusal: PlacementRefusal | null) => void,
  onTarget: (point: Point | null) => void,
) {
  useEffect(() => {
    let groundCursor: [number, number] | null = null
    const owns = (target: EventTarget | null) =>
      ownsTreePlacement('3d', target) && !context.isCameraDragging()
    const move = (event: GridEvent) => {
      if (!owns(event.nativeEvent?.target ?? null)) return
      groundCursor = [event.position[0], event.position[2]]
      // The target stands where a click would plant, snapping included.
      const landing = snapTreePlacementPoint(groundCursor, event.nativeEvent?.altKey)
      onTarget(landing)
    }
    emitter.on('grid:move', move)
    const unsubscribe = subscribeFloorPlacementClicks((event) => {
      if (!owns(event.nativeEvent?.target ?? null)) return
      stopPlacementCommitPropagation(event)
      const raw: [number, number] | null =
        'node' in event ? groundCursor : [event.position[0], event.position[2]]
      if (!raw) return
      const at = snapTreePlacementPoint(raw, event.nativeEvent?.altKey)
      const frame = siteFrame(context.sceneApi, context.activeLevelId)
      if (
        placeTree(context.sceneApi, at, context.selectNode, frame?.site.id, (code) =>
          onRefusal({ code, at }),
        )
      ) {
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
    })
    const stopViewWatch = useEditor.subscribe((state, before) => {
      if (visibleScene(state) !== visibleScene(before)) {
        groundCursor = null
        onRefusal(null)
        onTarget(null)
      }
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribe()
      stopViewWatch()
    }
  }, [
    context.sceneApi,
    context.activeLevelId,
    context.selectNode,
    context.isCameraDragging,
    onRefusal,
    onTarget,
  ])
}

/** Keep the same point object while the landing point has not moved, so a still pointer redraws nothing. */
const samePoint = (next: Point | null) => (current: Point | null) =>
  current && next && current[0] === next[0] && current[1] === next[1] ? current : next

export default function TreeTool() {
  useTreePlacementScope()
  const i18n = usePascalI18n()
  const scene = useThree((state) => state.scene)
  const context = useRegistryToolContext()
  const [refusal, setRefusal] = useState<PlacementRefusal | null>(null)
  const [target, setTarget] = useState<Point | null>(null)
  const showTarget = useCallback((point: Point | null) => setTarget(samePoint(point)), [])
  useTreePlacementInput(context, setRefusal, showTarget)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const ground = resolveSiteGround(frame?.site.id, context.sceneApi.nodes())
  // ToolManager mounts under the active building; the Site-space target must not inherit it.
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      <GardenToolTarget at={target} ground={ground} />
      {refusal && (
        <Html
          position={[
            refusal.at[0],
            ground.heightAt(refusal.at[0], refusal.at[1]) + 0.2,
            refusal.at[1],
          ]}
          style={{ pointerEvents: 'none', width: 260 }}
        >
          <p className="rounded-lg bg-background p-2 text-xs text-foreground" role="status">
            {treePlacementMessage(refusal.code, i18n)}
          </p>
        </Html>
      )}
    </group>,
    scene,
  )
}
