'use client'

import {
  type AnyNodeId,
  emitter,
  type FootingNode,
  type FootingShape,
  footingDesign,
  footingLevelOf,
  type GridEvent,
  type LevelNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  getSegmentGridStep,
  isAngleSnapActive,
  isMagneticSnapActive,
  isSegmentLongEnough,
  markToolCancelConsumed,
  snapBuildingLocalToWorldGrid,
  snapWallDraftPoint,
  triggerSFX,
  useEditor,
  usePlacementPreview,
  visibleScene,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { DoubleSide } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  type FloorPlacementClickTriggerEvent,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { draftFooting, footingSnapTargets } from './drafting'
import { useFootingGeometry } from './renderer'

const ghostMaterial = new MeshBasicNodeMaterial({
  color: '#f59e0b',
  depthWrite: false,
  opacity: 0.45,
  side: DoubleSide,
  transparent: true,
})

/**
 * Drafting a footing: a strip from two clicks, a pad from one (the tool's shape choice), from the
 * grid events both views send. Footings go on the building's lowest level, so the tool shows that
 * level: its walls are the ones footings snap to and its plan is where they are drawn. Points snap
 * as walls do: wall and footing ends, midpoints, crossings and centrelines, the grid, and from a
 * strip's first point the angle steps. Alt places freely. `enabled` off, it stands aside.
 */
function useFootingDrafting(enabled: boolean) {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const shape = useEditor((state) =>
    state.toolDefaults.footing?.shape === 'pad' ? 'pad' : 'strip',
  ) as FootingShape
  const levelId = useScene((state) =>
    activeLevelId ? (footingLevelOf(state.nodes, activeLevelId)?.id ?? null) : null,
  )
  const [draft, setDraft] = useState<FootingNode | null>(null)
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)

  useEffect(() => {
    if (enabled && levelId && levelId !== activeLevelId) {
      useViewer.getState().setSelection({ levelId: levelId as LevelNode['id'] })
    }
  }, [enabled, levelId, activeLevelId])

  useEffect(() => {
    if (!(enabled && levelId)) return
    let start: WallPlanPoint | null = null
    let last: WallPlanPoint | null = null
    setDraft(null)

    const snap = (event: GridEvent | FloorPlacementClickTriggerEvent): WallPlanPoint => {
      const raw: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]
      if (event.nativeEvent?.altKey) return raw
      const step = getSegmentGridStep()
      return snapWallDraftPoint({
        point: raw,
        walls: footingSnapTargets(useScene.getState().nodes, levelId),
        start: start ?? undefined,
        angleSnap: start !== null && isAngleSnapActive(),
        magnetic: isMagneticSnapActive(),
        gridSnap: (point) => snapBuildingLocalToWorldGrid(point, step),
      })
    }
    const show = (next: FootingNode | null) => {
      setDraft(next)
      if (next) usePlacementPreview.getState().set({ ...next, parentId: levelId })
      else usePlacementPreview.getState().clear()
    }

    const onMove = (event: GridEvent) => {
      const point = snap(event)
      if (last && point[0] === last[0] && point[1] === last[1]) return
      last = point
      setCursor([point[0], event.localPosition[1], point[1]])
      show(draftFooting(shape, start, point))
    }
    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const point = last ?? snap(event)
      stopPlacementCommitPropagation(event)
      if (shape === 'strip' && !start) {
        start = point
        triggerSFX('sfx:grid-snap')
        return
      }
      if (start && !isSegmentLongEnough(start, point)) return
      const nodes = useScene.getState().nodes
      const count = Object.values(nodes).filter((node) => node.type === 'footing').length
      const footing = draftFooting(shape, start, point, { name: `Footing ${count + 1}` })
      if (!footing) return
      useScene.getState().createNode(footing, levelId as AnyNodeId)
      triggerSFX('sfx:structure-build')
      start = null
      show(null)
    }
    const onCancel = () => {
      if (!start) return
      markToolCancelConsumed()
      start = null
      show(last ? draftFooting(shape, null, last) : null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('tool:cancel', onCancel)
    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('tool:cancel', onCancel)
      unsubscribeClicks()
      usePlacementPreview.getState().clear()
      setDraft(null)
      setCursor(null)
    }
  }, [enabled, levelId, shape])

  return { levelId, draft, cursor }
}

/**
 * The footing tool in 2D-only view: the 3D tool lives in the canvas, which never renders while its
 * pane is hidden. The plan draws the draft from the placement preview. Split and 3D views keep the
 * 3D tool as the one owner.
 */
export function FootingFloorplanTool() {
  useFootingDrafting(useEditor((state) => visibleScene(state) === '2d'))
  return null
}

const FootingTool = () => {
  const { levelId, draft, cursor } = useFootingDrafting(
    useEditor((state) => visibleScene(state) !== '2d'),
  )
  const nodes = useScene((state) => state.nodes)
  const ghost = useFootingGeometry(
    useMemo(
      () => (draft && levelId ? footingDesign(nodes, { ...draft, parentId: levelId }) : null),
      [draft, levelId, nodes],
    ),
  )
  const level = levelId ? sceneRegistry.nodes.get(levelId) : undefined

  if (!levelId) return null
  return (
    <>
      {cursor && <CursorSphere position={cursor} />}
      {ghost &&
        level &&
        createPortal(
          <mesh geometry={ghost} material={ghostMaterial} raycast={() => {}} renderOrder={2} />,
          level,
        )}
    </>
  )
}

export default FootingTool
