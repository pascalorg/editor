'use client'

import {
  DEFAULT_ANGLE_STEP,
  emitter,
  type GridEvent,
  type LevelNode,
  snapPointAlongAngleRay,
  snapPointToGrid,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { triggerSFX } from '../../../lib/sfx-bus'
import { clearSlabSnapFeedback, resolveSlabPlanPointSnap } from '../../../lib/slab-plan-snap'
import useEditor, { isAngleSnapActive, isGridSnapActive } from '../../../store/use-editor'
import { useFloorplanDraftPreview } from '../../../store/use-floorplan-draft-preview'
import { CursorSphere } from '../shared/cursor-sphere'
import { type PlanPoint, sanitizeDeckPolygon } from './deck-plan'

/**
 * Shared deck-footprint drawing for the mezzanine / balcony tools — the slab
 * tool's multi-click polygon flow (same snap pipeline, same finish gestures:
 * close near the first vertex, Enter, or double-click; Esc clears the draft)
 * with the 3D preview lifted to the deck elevation. The 2D floor plan draws
 * the same draft as a slab ghost via the shared draft-preview store; the
 * panel's grid catch-all synthesizes the grid events this component consumes,
 * so both views draft identically.
 */

const Y_OFFSET = 0.02

type DeckDrawToolProps = {
  /** Deck walking-surface elevation (meters above the level plane). */
  elevation: number
  onCommit: (levelId: LevelNode['id'], points: PlanPoint[]) => void
}

export const DeckDrawTool: React.FC<DeckDrawToolProps> = ({ elevation, onCommit }) => {
  const cursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((s) => s.selection.levelId)

  const [points, setPoints] = useState<PlanPoint[]>([])
  const [cursorPosition, setCursorPosition] = useState<PlanPoint>([0, 0])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<PlanPoint>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const previousSnappedPointRef = useRef<PlanPoint | null>(null)

  useEffect(() => () => clearSlabSnapFeedback(), [])

  // Publish the live vertex count so the HUD shows "Finish" only at ≥ 3 points.
  useEffect(() => {
    useEditor.getState().setDraftVertexCount(points.length)
  }, [points.length])
  useEffect(() => () => useEditor.getState().setDraftVertexCount(0), [])

  // The deck draft is a slab ghost in the 2D floor plan.
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

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return
      const rawPoint: PlanPoint = [event.localPosition[0], event.localPosition[2]]
      const gridStep = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const gridPosition: PlanPoint = [...snapPointToGrid(rawPoint, gridStep)]
      setCursorPosition(gridPosition)
      setLevelY(event.localPosition[1])
      const lastPoint = points[points.length - 1]
      const orthoPoint: PlanPoint =
        isAngleSnapActive() && lastPoint
          ? [...snapPointAlongAngleRay(lastPoint, rawPoint, DEFAULT_ANGLE_STEP, gridStep)]
          : gridPosition
      const displayPoint = resolveSlabPlanPointSnap({
        rawPoint,
        fallbackPoint: orthoPoint,
        levelId: currentLevelId,
      }).point
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
      cursorRef.current.position.set(displayPoint[0], event.localPosition[1], displayPoint[1])
    }

    const commitDraft = () => {
      const polygon = sanitizeDeckPolygon(points)
      if (polygon.length >= 3) {
        onCommit(currentLevelId, polygon)
      }
      setPoints([])
      clearSlabSnapFeedback()
    }

    const onGridClick = (_event: GridEvent) => {
      if (!currentLevelId) return
      const clickPoint = previousSnappedPointRef.current ?? cursorPosition
      const firstPoint = points[0]
      if (
        points.length >= 3 &&
        firstPoint &&
        Math.abs(clickPoint[0] - firstPoint[0]) < 0.25 &&
        Math.abs(clickPoint[1] - firstPoint[1]) < 0.25
      ) {
        commitDraft()
      } else {
        triggerSFX('sfx:structure-build-start')
        setPoints([...points, clickPoint])
      }
    }

    const finishDrawing = () => {
      if (points.length < 3) return
      commitDraft()
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      finishDrawing()
    }

    const onCancel = () => {
      if (points.length > 0) markToolCancelConsumed()
      setPoints([])
      clearSlabSnapFeedback()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finishDrawing()
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
  }, [currentLevelId, points, cursorPosition, onCommit])

  // Draft polyline + closing line, drawn at the DECK elevation so the user
  // sees where the platform will actually float.
  useEffect(() => {
    if (!(mainLineRef.current && closingLineRef.current)) return
    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      return
    }
    const y = levelY + elevation + Y_OFFSET
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
  }, [points, snappedCursorPosition, levelY, elevation])

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
          position={[0, levelY + elevation + Y_OFFSET, 0]}
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
          position={[x, levelY + elevation + Y_OFFSET + 0.01, z]}
          showTooltip={false}
        />
      ))}
    </group>
  )
}
