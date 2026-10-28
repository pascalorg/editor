'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  emitter,
  FoundationNode,
  footingLevelOf,
  type GridEvent,
  type LevelNode,
  sceneRegistry,
  snapPointAlongAngleRay,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearSlabSnapFeedback,
  getSegmentGridStep,
  isAngleSnapActive,
  markToolCancelConsumed,
  snapBuildingLocalToWorldGrid,
  triggerSFX,
  useEditor,
  usePlacementPreview,
  visibleScene,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { BufferGeometry, Line, Vector3 } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import {
  type FloorPlacementClickTriggerEvent,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { useFoundationDraw } from './family'
import { FOUNDATION_DRAFT_ID } from './floorplan'
import { snapPointToWallFaces, wallFacesOf } from './wall-face-snap'

type P = [number, number]

/** A click this close to the first corner closes the outline. */
const CLOSE_DISTANCE = 0.25
/** The draft line stands just over the level plane, where the slab's top will be. */
const DRAFT_HEIGHT = 0.12

const draftMaterial = new LineBasicNodeMaterial({
  color: '#475569',
  depthTest: false,
  depthWrite: false,
})

const OUTLINE_NAMES = { building: 'Foundation', slab: 'Slab', raised: 'Raised floor' } as const

/** The outline drawn so far as a foundation node, for the plan's placement preview. */
function draftNode(points: P[], levelId: string) {
  return {
    ...FoundationNode.parse({
      id: FOUNDATION_DRAFT_ID,
      polygon: points,
      construction: useFoundationDraw.getState().construction,
    }),
    parentId: levelId,
  }
}

/**
 * Drawing a foundation outline, corner by corner, from the grid events both views send: a click
 * places a corner, a click on the first corner (or Enter, from three corners) closes it. Corners
 * snap onto the walls' outside faces and their corners (where the traced foundation runs), else to
 * the grid and, from the second, along the angle steps; Alt places freely; Esc drops the corners
 * placed. Outlines go on the building's lowest
 * level, as footings do, so the tool shows that level. `enabled` off, it stands aside.
 */
function useFoundationDrafting(enabled: boolean) {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const levelId = useScene((state) =>
    activeLevelId ? (footingLevelOf(state.nodes, activeLevelId)?.id ?? null) : null,
  )
  const [points, setPoints] = useState<P[]>([])
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)

  useEffect(() => {
    if (enabled && levelId && levelId !== activeLevelId)
      useViewer.getState().setSelection({ levelId: levelId as LevelNode['id'] })
  }, [enabled, levelId, activeLevelId])

  useEffect(() => {
    if (!(enabled && levelId)) return
    let placed: P[] = []
    let last: P | null = null
    // The walls' outside faces, where the foundation traced from them runs: corners snap there first.
    const faces = wallFacesOf(useScene.getState().nodes as Record<string, AnyNode>, levelId)

    const snap = (event: GridEvent | FloorPlacementClickTriggerEvent): P => {
      const raw: P = [event.localPosition[0], event.localPosition[2]]
      if (event.nativeEvent?.altKey) return raw
      const face = snapPointToWallFaces(faces, raw)
      if (face) return face
      // Off the faces, the grid (a slab's snap would take the walls' centrelines).
      const step = getSegmentGridStep()
      const previous = placed[placed.length - 1]
      return previous && isAngleSnapActive()
        ? [...snapPointAlongAngleRay(previous, raw, DEFAULT_ANGLE_STEP, step)]
        : [...snapBuildingLocalToWorldGrid(raw, step)]
    }
    const show = (at: P | null) => {
      const outline = at ? [...placed, at] : [...placed]
      if (outline.length >= 2) usePlacementPreview.getState().set(draftNode(outline, levelId))
      else usePlacementPreview.getState().clear()
      setPoints([...placed])
      useEditor.getState().setDraftVertexCount(placed.length)
    }
    const finish = () => {
      if (placed.length < 3) return false
      const nodes = useScene.getState().nodes
      const count = Object.values(nodes).filter((node) => node.type === 'foundation').length
      const construction = useFoundationDraw.getState().construction
      const outline = FoundationNode.parse({
        name: `${OUTLINE_NAMES[construction]} ${count + 1}`,
        polygon: placed,
        construction,
      })
      useScene.getState().createNode(outline, levelId as AnyNodeId)
      triggerSFX('sfx:structure-build')
      clearSlabSnapFeedback()
      placed = []
      show(null)
      useViewer.getState().setSelection({ selectedIds: [outline.id] })
      return true
    }

    const onMove = (event: GridEvent) => {
      const point = snap(event)
      if (last && point[0] === last[0] && point[1] === last[1]) return
      last = point
      setCursor([point[0], event.localPosition[1], point[1]])
      show(point)
    }
    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const point = last ?? snap(event)
      stopPlacementCommitPropagation(event)
      const first = placed[0]
      if (
        placed.length >= 3 &&
        first &&
        Math.hypot(point[0] - first[0], point[1] - first[1]) < CLOSE_DISTANCE
      ) {
        finish()
        return
      }
      const previous = placed[placed.length - 1]
      if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 1e-6) return
      placed.push(point)
      triggerSFX('sfx:structure-build-start')
      show(point)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat) return
      if (finish()) event.preventDefault()
    }
    const onCancel = () => {
      if (placed.length === 0) return
      markToolCancelConsumed()
      placed = []
      show(null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('tool:cancel', onCancel)
    const keys = typeof window === 'undefined' ? null : window
    keys?.addEventListener('keydown', onKeyDown)
    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('tool:cancel', onCancel)
      keys?.removeEventListener('keydown', onKeyDown)
      unsubscribeClicks()
      usePlacementPreview.getState().clear()
      useEditor.getState().setDraftVertexCount(0)
      clearSlabSnapFeedback()
      setPoints([])
      setCursor(null)
    }
  }, [enabled, levelId])

  return { levelId, points, cursor }
}

/**
 * The foundation tool in 2D-only view: the 3D tool lives in the canvas, which never renders while
 * its pane is hidden. The plan draws the draft from the placement preview.
 */
export function FoundationFloorplanTool() {
  useFoundationDrafting(useEditor((state) => visibleScene(state) === '2d'))
  return null
}

const FoundationTool = () => {
  const { levelId, points, cursor } = useFoundationDrafting(
    useEditor((state) => visibleScene(state) !== '2d'),
  )
  const draft = useMemo(() => {
    const line = new Line(new BufferGeometry(), draftMaterial)
    line.frustumCulled = false
    line.renderOrder = 2
    return line
  }, [])
  useEffect(() => {
    const corners = cursor ? [...points, [cursor[0], cursor[2]] as P] : points
    const previous = draft.geometry
    draft.geometry = new BufferGeometry().setFromPoints(
      corners.map(([x, z]) => new Vector3(x, DRAFT_HEIGHT, z)),
    )
    draft.visible = corners.length >= 2
    previous.dispose()
  }, [draft, points, cursor])
  useEffect(() => () => draft.geometry.dispose(), [draft])
  const level = levelId ? sceneRegistry.nodes.get(levelId as AnyNodeId) : undefined

  if (!levelId) return null
  return (
    <>
      {cursor && <CursorSphere position={cursor} />}
      {level &&
        createPortal(
          <>
            <primitive object={draft} />
            {points.map(([x, z], index) => (
              <CursorSphere
                color="#475569"
                key={index}
                position={[x, DRAFT_HEIGHT, z]}
                showTooltip={false}
              />
            ))}
          </>,
          level,
        )}
    </>
  )
}

export default FoundationTool
