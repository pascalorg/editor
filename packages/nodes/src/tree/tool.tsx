'use client'

import { emitter, type GridEvent, resolveSiteGround, usePascalI18n } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { siteFrame } from '../shared/site-frame'
import { ownsTreePlacement, placeTree, snapTreePlacementPoint } from './placement'
import { treePlacementMessage } from './placement-message'
import { useTreePlacementScope } from './placement-scope'

type PlacementRefusal = { code: string; at: [number, number] }

function useTreePlacementInput(
  context: ReturnType<typeof useRegistryToolContext>,
  onRefusal: (refusal: PlacementRefusal | null) => void,
) {
  useEffect(() => {
    let groundCursor: [number, number] | null = null
    const owns = (target: EventTarget | null) =>
      ownsTreePlacement('3d', target) && !context.isCameraDragging()
    const move = (event: GridEvent) => {
      if (!owns(event.nativeEvent?.target ?? null)) return
      groundCursor = [event.position[0], event.position[2]]
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
  ])
}

export default function TreeTool() {
  useTreePlacementScope()
  const i18n = usePascalI18n()
  const scene = useThree((state) => state.scene)
  const context = useRegistryToolContext()
  const [refusal, setRefusal] = useState<PlacementRefusal | null>(null)
  useTreePlacementInput(context, setRefusal)
  if (!refusal) return null
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const [x, z] = refusal.at
  const ground = resolveSiteGround(frame?.site.id, context.sceneApi.nodes())
  return createPortal(
    <Html
      position={[x, ground.heightAt(x, z) + 0.2, z]}
      style={{ pointerEvents: 'none', width: 260 }}
    >
      <p className="rounded-lg bg-background p-2 text-xs text-foreground" role="status">
        {treePlacementMessage(refusal.code, i18n)}
      </p>
    </Html>,
    scene,
  )
}
