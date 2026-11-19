'use client'

import { emitter, type GridEvent, HedgeNode, resolveSiteGround } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { GardenDraftPreview } from '../shared/garden-draft-preview'
import { siteFrame } from '../shared/site-frame'
import { gridEventSiteGround } from '../shared/site-pointer-ground'
import { snapHedgeDraftPoint, useHedgeDraft, useHedgeDraftController } from './draft'

/** What a click-drawn hedge is planted with: the schema's own width and height. */
const HEDGE_DRAFT_VOLUME = {
  width: HedgeNode.shape.width.parse(undefined),
  height: HedgeNode.shape.height.parse(undefined),
}

/** Canvas input and the SVG tool share one Site-space draft, never the same pointer event. */
export default function HedgeTool() {
  const context = useRegistryToolContext()
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const finishTool = useCallback(() => useEditor.getState().setTool(null), [])
  const { addPoint, error } = useHedgeDraftController({
    ...context,
    siteId: frame?.site.id,
    finishTool,
    view: '3d',
  })
  useEffect(() => {
    const owns = (native?: { target: EventTarget | null }) =>
      visibleScene(useEditor.getState()) !== '2d' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      native?.target instanceof HTMLCanvasElement &&
      !context.isCameraDragging()
    // Under the pointer's own ray, not on the active floor's plane (see `sitePointerGround`).
    const groundUnder = (event: Parameters<typeof gridEventSiteGround>[0]) => {
      const site = siteFrame(context.sceneApi, context.activeLevelId)?.site ?? null
      const ground = resolveSiteGround(site?.id, context.sceneApi.nodes())
      return gridEventSiteGround(event, camera, canvas, site, ground)
    }
    const move = (event: GridEvent) => {
      if (!owns(event.nativeEvent)) return
      useHedgeDraft.setState({
        hover: snapHedgeDraftPoint(groundUnder(event), event.nativeEvent?.altKey),
      })
    }
    emitter.on('grid:move', move)
    const unsubscribe = subscribeFloorPlacementClicks((event) => {
      if (!owns(event.nativeEvent)) return
      stopPlacementCommitPropagation(event)
      const point =
        'node' in event
          ? useHedgeDraft.getState().hover
          : snapHedgeDraftPoint(groundUnder(event), event.nativeEvent?.altKey)
      if (point) addPoint(point)
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribe()
    }
  }, [addPoint, context.isCameraDragging, context.sceneApi, context.activeLevelId, camera, canvas])
  const points = useHedgeDraft((draft) => draft.points)
  const hover = useHedgeDraft((draft) => draft.hover)
  const ground = resolveSiteGround(frame?.site.id, context.sceneApi.nodes())
  const first = points[0]
  // ToolManager mounts under the building; a Site-space guide must not inherit its transform.
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      <GardenDraftPreview
        closed={false}
        ground={ground}
        hover={hover}
        invalid={!!error}
        lift={0.05}
        points={points}
        volume={HEDGE_DRAFT_VOLUME}
      />
      {error && first && (
        <Html
          position={[first[0], ground.heightAt(first[0], first[1]) + 0.05, first[1]]}
          style={{ pointerEvents: 'none', width: 260 }}
        >
          <p className="rounded-lg bg-background p-2 text-xs text-foreground" role="status">
            {error}
          </p>
        </Html>
      )}
    </group>,
    scene,
  )
}
