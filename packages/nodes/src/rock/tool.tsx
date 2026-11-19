'use client'

import { emitter, type GridEvent, resolveSiteGround } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { createPortal, useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { GardenToolTarget } from '../shared/garden-draft-preview'
import { siteFrame } from '../shared/site-frame'
import { ownsRockPlacement, placeRock, snapRockPlacementPoint } from './placement'
import { useRockPlacementScope } from './placement-scope'

/** Point placement has no persisted draft; the panel edits the rock after its single commit. */
export default function RockTool() {
  useRockPlacementScope()
  const { sceneApi, activeLevelId, selectNode, isCameraDragging } = useRegistryToolContext()
  const scene = useThree((state) => state.scene)
  const [target, setTarget] = useState<[number, number] | null>(null)
  useEffect(() => {
    let groundCursor: [number, number] | null = null
    const move = (event: GridEvent) => {
      if (!ownsRockPlacement('3d', event.nativeEvent?.target ?? null) || isCameraDragging()) return
      groundCursor = [event.position[0], event.position[2]]
      // The target stands where a click would set the rock, snapping included.
      const landing = snapRockPlacementPoint(groundCursor, event.nativeEvent?.altKey)
      setTarget((current) =>
        current && current[0] === landing[0] && current[1] === landing[1] ? current : landing,
      )
    }
    emitter.on('grid:move', move)
    const unsubscribe = subscribeFloorPlacementClicks((event) => {
      if (!ownsRockPlacement('3d', event.nativeEvent?.target ?? null) || isCameraDragging()) return
      stopPlacementCommitPropagation(event)
      // A face hit commits the last ground cursor, not a point halfway up a wall.
      const raw = 'node' in event ? groundCursor : [event.position[0], event.position[2]]
      if (!raw) return
      const at = snapRockPlacementPoint([raw[0]!, raw[1]!], event.nativeEvent?.altKey)
      const frame = siteFrame(sceneApi, activeLevelId)
      if (placeRock(sceneApi, at, selectNode, frame?.site.id)) {
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
    })
    const stopViewWatch = useEditor.subscribe((state, before) => {
      if (visibleScene(state) === visibleScene(before)) return
      groundCursor = null
      setTarget(null)
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribe()
      stopViewWatch()
    }
  }, [sceneApi, activeLevelId, selectNode, isCameraDragging])
  const ground = resolveSiteGround(siteFrame(sceneApi, activeLevelId)?.site.id, sceneApi.nodes())
  // ToolManager mounts under the active building; the Site-space target must not inherit it.
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      <GardenToolTarget at={target} ground={ground} />
    </group>,
    scene,
  )
}
