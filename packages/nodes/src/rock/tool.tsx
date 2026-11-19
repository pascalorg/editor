'use client'

import { emitter, type GridEvent, resolveSiteGround } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { createPortal, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import type { Mesh } from 'three'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { GardenGhost, GardenToolTarget } from '../shared/garden-draft-preview'
import { applyGhost } from '../shared/ghost-materials'
import { siteFrame } from '../shared/site-frame'
import { gridEventSiteGround } from '../shared/site-pointer-ground'
import { buildRockGeometry } from './geometry'
import {
  drawRockSeed,
  ownsRockPlacement,
  placeRock,
  previewRock,
  snapRockPlacementPoint,
} from './placement'
import { useRockPlacementScope } from './placement-scope'

/** Point placement has no persisted draft; the panel edits the rock after its single commit. */
export default function RockTool() {
  useRockPlacementScope()
  const { sceneApi, activeLevelId, selectNode, isCameraDragging } = useRegistryToolContext()
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const [target, setTarget] = useState<[number, number] | null>(null)
  // The rock a click sets is the one shown: drawn once, when the tool is taken.
  const [seed] = useState(drawRockSeed)
  const siteId = siteFrame(sceneApi, activeLevelId)?.site.id
  const ghost = useMemo(() => {
    const rock = previewRock(sceneApi.nodes(), siteId, seed)
    if (!rock) return null
    // Without its Site the rock is built around the origin on the datum: the tool moves it.
    const root = buildRockGeometry({ ...rock, parentId: null })
    return { root, release: applyGhost(root) }
  }, [sceneApi, siteId, seed])
  useEffect(
    () => () => {
      ghost?.release()
      ghost?.root.traverse((object) => (object as Mesh).geometry?.dispose())
    },
    [ghost],
  )
  useEffect(() => {
    let groundCursor: [number, number] | null = null
    // Under the pointer's own ray, not on the active floor's plane (see `sitePointerGround`).
    const groundUnder = (event: Parameters<typeof gridEventSiteGround>[0]) => {
      const site = siteFrame(sceneApi, activeLevelId)?.site ?? null
      return gridEventSiteGround(
        event,
        camera,
        canvas,
        site,
        resolveSiteGround(site?.id, sceneApi.nodes()),
      )
    }
    const move = (event: GridEvent) => {
      if (!ownsRockPlacement('3d', event.nativeEvent?.target ?? null) || isCameraDragging()) return
      groundCursor = groundUnder(event)
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
      const raw = 'node' in event ? groundCursor : groundUnder(event)
      if (!raw) return
      const at = snapRockPlacementPoint([raw[0]!, raw[1]!], event.nativeEvent?.altKey)
      const frame = siteFrame(sceneApi, activeLevelId)
      if (placeRock(sceneApi, at, selectNode, frame?.site.id, undefined, seed)) {
        // The rock stands; its ghost and target go.
        setTarget(null)
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
  }, [sceneApi, activeLevelId, selectNode, isCameraDragging, camera, canvas, seed])
  const ground = resolveSiteGround(siteId, sceneApi.nodes())
  // ToolManager mounts under the active building; the Site-space target must not inherit it.
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      <GardenToolTarget at={target} ground={ground} />
      <GardenGhost at={target} ground={ground} object={ghost?.root ?? null} />
    </group>,
    scene,
  )
}
