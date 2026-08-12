'use client'

import {
  DEFAULT_ANGLE_STEP,
  emitter,
  type GridEvent,
  type LevelNode,
  resolveSlabPlacementElevation,
  snapPointAlongAngleRay,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearPlacementSurface,
  clearSlabSnapFeedback,
  EDITOR_LAYER,
  type HorizontalConstructionPlane,
  isAngleSnapActive,
  isGridSnapActive,
  markToolCancelConsumed,
  publishHorizontalConstructionPlane,
  publishPlacementSurface,
  resampleTerrainConstructionPlane,
  resolveEventConstructionPlane,
  resolveLevelConstructionPlane,
  resolvePointerSupportSurface,
  resolveSlabPlanPointSnap,
  triggerSFX,
  useEditor,
  useFloorplanDraftPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { type SlabCompletionTrigger, shouldRegistryCommitSlab } from './placement-ownership'
import { SlabNode } from './schema'

/**
 * Phase 5 Stage D — slab placement tool (kind-owned via `def.tool`).
 *
 * Multi-click polygon drawing: each click adds a vertex; clicking near
 * the first vertex (or double-clicking) closes the polygon and creates
 * the slab. Shift-modifier defeats the 15° angle snap during drag.
 *
 * Not a `DragAction` — same reasoning as `tool.tsx` for fence: this is
 * a stateful sequence of grid:click events with preview state, not a
 * single pointer-down → drag-up.
 */

const Y_OFFSET = 0.02
const SURFACE_UP = new Vector3(0, 1, 0)
const surfacePointScratch = new Vector3()

function commitSlabDrawing(
  levelId: LevelNode['id'],
  points: Array<[number, number]>,
  baseElevation: number | null,
): string {
  const { createNode, nodes } = useScene.getState()
  const slabCount = Object.values(nodes).filter((n) => n.type === 'slab').length
  const name = `Slab ${slabCount + 1}`
  // A placed slab preset seeds `toolDefaults.slab` (thickness, material, …)
  // before the tool activates; the drawn polygon always wins.
  const defaults = useEditor.getState().toolDefaults.slab ?? {}
  const authored = SlabNode.parse({ ...defaults, name, polygon: points })
  const slab = {
    ...authored,
    elevation: resolveSlabPlacementElevation(authored, baseElevation),
  }
  createNode(slab, levelId)
  triggerSFX('sfx:structure-build')
  return slab.id
}

export const SlabTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((s) => s.selection.levelId)
  const setSelection = useViewer((s) => s.setSelection)
  const slabDefaults = useEditor((s) => s.toolDefaults.slab)
  const isRecessed = slabDefaults?.recessed === true
  const camera = useThree((state) => state.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const [points, setPoints] = useState<Array<[number, number]>>([])
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<[number, number]>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const previousSnappedPointRef = useRef<[number, number] | null>(null)
  const constructionPlaneRef = useRef<HorizontalConstructionPlane | null>(null)

  // Clear preset-seeded defaults on deactivation so a later manual slab draw
  // isn't built with a stale preset's parameters. Unmount-only.
  useEffect(() => () => useEditor.getState().setToolDefaults('slab', null), [])

  useEffect(
    () => () => {
      clearSlabSnapFeedback()
      clearPlacementSurface()
    },
    [],
  )

  // Publish the live vertex count so the HUD shows "Finish" only at ≥ 3 points.
  useEffect(() => {
    useEditor.getState().setDraftVertexCount(points.length)
  }, [points.length])
  useEffect(() => () => useEditor.getState().setDraftVertexCount(0), [])

  useEffect(() => {
    useFloorplanDraftPreview.getState().setPolygonDraft('slab', points)
  }, [points])
  useEffect(
    () => () => {
      const draftPreview = useFloorplanDraftPreview.getState()
      if (draftPreview.polygonDraftType === 'slab') {
        draftPreview.setPolygonDraft(null, [])
      }
      draftPreview.setCursorPoint(null)
    },
    [],
  )

  useEffect(() => {
    if (!currentLevelId) return

    const pointedSurfaceFor = (event: GridEvent) =>
      event.nativeEvent?.target instanceof HTMLCanvasElement
        ? resolvePointerSupportSurface(cameraRef.current, event.position)
        : null

    const resetDraft = () => {
      setPoints([])
      constructionPlaneRef.current = null
      previousSnappedPointRef.current = null
      clearSlabSnapFeedback()
      clearPlacementSurface()
    }

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return
      const pointed = points.length === 0 && !isRecessed ? pointedSurfaceFor(event) : null
      const plane =
        constructionPlaneRef.current ?? (isRecessed ? resolveLevelConstructionPlane() : null)
      if (plane) {
        publishHorizontalConstructionPlane(event, plane)
      } else if (pointed) {
        publishPlacementSurface(
          surfacePointScratch.set(event.position[0], pointed.worldY, event.position[2]),
          SURFACE_UP,
        )
      }

      const localPosition = pointed?.localPoint ?? event.localPosition
      const rawPoint: [number, number] = [localPosition[0], localPosition[2]]
      // Slab drafting is the 'polygon' snap context (grid / lines / off — no
      // angle, no Shift bypass; Shift cycles the mode, Off is the bypass).
      const gridStep = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const gridPosition: [number, number] = [...snapPointToGrid(rawPoint, gridStep)]
      setCursorPosition(gridPosition)
      const lastPoint = points[points.length - 1]
      // Angle lock only when the mode asks for it (polygon never does today, but
      // honour the flag so the behaviour follows the HUD).
      const orthoPoint: [number, number] =
        isAngleSnapActive() && lastPoint
          ? [...snapPointAlongAngleRay(lastPoint, rawPoint, DEFAULT_ANGLE_STEP, gridStep)]
          : gridPosition
      const displayPoint = resolveSlabPlanPointSnap({
        rawPoint,
        fallbackPoint: orthoPoint,
        levelId: currentLevelId,
        // The previous vertex is what a typed edge length measures from.
        previousPoint: lastPoint,
      }).point
      const hoverPlane =
        plane ??
        resampleTerrainConstructionPlane(
          resolveEventConstructionPlane(event, pointed),
          displayPoint,
        )
      setLevelY(hoverPlane.localY)
      useFloorplanDraftPreview.getState().setCursorPoint(displayPoint)
      setSnappedCursorPosition(displayPoint)
      if (
        points.length > 0 &&
        previousSnappedPointRef.current &&
        (displayPoint[0] !== previousSnappedPointRef.current[0] ||
          displayPoint[1] !== previousSnappedPointRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousSnappedPointRef.current = displayPoint
      cursorRef.current.position.set(displayPoint[0], hoverPlane.localY, displayPoint[1])
    }

    const onGridClick = (event: GridEvent) => {
      if (!currentLevelId) return
      const clickPoint = previousSnappedPointRef.current ?? cursorPosition
      const firstPoint = points[0]
      if (
        points.length >= 3 &&
        firstPoint &&
        Math.abs(clickPoint[0] - firstPoint[0]) < 0.25 &&
        Math.abs(clickPoint[1] - firstPoint[1]) < 0.25
      ) {
        if (shouldRegistryCommitSlab(useEditor.getState().viewMode, 'grid')) {
          const slabId = commitSlabDrawing(
            currentLevelId,
            points,
            constructionPlaneRef.current?.elevation ?? null,
          )
          setSelection({ selectedIds: [slabId] })
        }
        resetDraft()
      } else {
        if (points.length === 0) {
          const plane = isRecessed
            ? (resolveLevelConstructionPlane() ?? resolveEventConstructionPlane(event, null))
            : resampleTerrainConstructionPlane(
                resolveEventConstructionPlane(event, pointedSurfaceFor(event)),
                clickPoint,
              )
          constructionPlaneRef.current = plane
          setLevelY(plane.localY)
          publishHorizontalConstructionPlane(event, plane)
        }
        // Every non-closing vertex is a "start" tick; the closing click above
        // fires the structure-build (end) cue.
        triggerSFX('sfx:structure-build-start')
        setPoints([...points, clickPoint])
      }
    }

    // Finish the polygon (Enter or double-click): commit once there are enough
    // vertices. Closing near the first vertex (in onGridClick) is the third way.
    const finishDrawing = (trigger: SlabCompletionTrigger) => {
      if (points.length < 3) return
      if (shouldRegistryCommitSlab(useEditor.getState().viewMode, trigger)) {
        const slabId = commitSlabDrawing(
          currentLevelId,
          points,
          constructionPlaneRef.current?.elevation ?? null,
        )
        setSelection({ selectedIds: [slabId] })
      }
      resetDraft()
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      finishDrawing('grid')
    }

    const onCancel = () => {
      if (points.length > 0) markToolCancelConsumed()
      resetDraft()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finishDrawing('keyboard')
      }
    }
    document.addEventListener('keydown', onKeyDown)

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [currentLevelId, points, cursorPosition, isRecessed, setSelection])

  useEffect(() => {
    if (!(mainLineRef.current && closingLineRef.current)) return
    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      return
    }
    const y = levelY + Y_OFFSET
    const snappedCursor = snappedCursorPosition
    const linePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, y, z))
    linePoints.push(new Vector3(snappedCursor[0], y, snappedCursor[1]))
    if (linePoints.length >= 2) {
      mainLineRef.current.geometry.dispose()
      mainLineRef.current.geometry = new BufferGeometry().setFromPoints(linePoints)
      mainLineRef.current.visible = true
    } else {
      mainLineRef.current.visible = false
    }
    const firstPoint = points[0]
    if (points.length >= 2 && firstPoint) {
      const closingPoints = [
        new Vector3(snappedCursor[0], y, snappedCursor[1]),
        new Vector3(firstPoint[0], y, firstPoint[1]),
      ]
      closingLineRef.current.geometry.dispose()
      closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints)
      closingLineRef.current.visible = true
    } else {
      closingLineRef.current.visible = false
    }
  }, [points, snappedCursorPosition, levelY])

  const previewShape = useMemo(() => {
    if (points.length < 3) return null
    const snappedCursor = snappedCursorPosition
    const allPoints = [...points, snappedCursor]
    const firstPt = allPoints[0]
    if (!firstPt) return null
    const shape = new Shape()
    shape.moveTo(firstPt[0], -firstPt[1])
    for (let i = 1; i < allPoints.length; i++) {
      const pt = allPoints[i]
      if (pt) shape.lineTo(pt[0], -pt[1])
    }
    shape.closePath()
    return shape
  }, [points, snappedCursorPosition])

  return (
    <group>
      <CursorSphere ref={cursorRef} />
      {previewShape && (
        <mesh
          frustumCulled={false}
          layers={EDITOR_LAYER}
          position={[0, levelY + Y_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#818cf8"
            depthTest={false}
            opacity={0.15}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={mainLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial color="#818cf8" depthTest={false} depthWrite={false} linewidth={3} />
      </line>
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={closingLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.5}
          transparent
        />
      </line>
      {points.map(([x, z], index) => (
        <CursorSphere
          color="#818cf8"
          height={0}
          key={index}
          position={[x, levelY + Y_OFFSET + 0.01, z]}
          showTooltip={false}
        />
      ))}
    </group>
  )
}

export default SlabTool
