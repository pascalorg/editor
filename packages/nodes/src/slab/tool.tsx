'use client'

import {
  DEFAULT_ANGLE_STEP,
  emitter,
  type GridEvent,
  type LevelNode,
  snapPointAlongAngleRay,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearSlabSnapFeedback,
  EDITOR_LAYER,
  markToolCancelConsumed,
  resolveSlabPlanPointSnap,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
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

function commitSlabDrawing(levelId: LevelNode['id'], points: Array<[number, number]>): string {
  const { createNode, nodes } = useScene.getState()
  const slabCount = Object.values(nodes).filter((n) => n.type === 'slab').length
  const name = `Slab ${slabCount + 1}`
  // A placed slab preset seeds `toolDefaults.slab` (thickness, material, …)
  // before the tool activates; the drawn polygon always wins.
  const defaults = useEditor.getState().toolDefaults.slab ?? {}
  const slab = SlabNode.parse({ ...defaults, name, polygon: points })
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

  const [points, setPoints] = useState<Array<[number, number]>>([])
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<[number, number]>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const previousSnappedPointRef = useRef<[number, number] | null>(null)
  const shiftPressed = useRef(false)

  // Clear preset-seeded defaults on deactivation so a later manual slab draw
  // isn't built with a stale preset's parameters. Unmount-only.
  useEffect(() => () => useEditor.getState().setToolDefaults('slab', null), [])

  useEffect(() => () => clearSlabSnapFeedback(), [])

  useEffect(() => {
    if (!currentLevelId) return

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return
      const rawPoint: [number, number] = [event.localPosition[0], event.localPosition[2]]
      const bypassSnap = shiftPressed.current || event.nativeEvent?.shiftKey === true
      const gridX = Math.round(rawPoint[0] * 2) / 2
      const gridZ = Math.round(rawPoint[1] * 2) / 2
      const gridPosition: [number, number] = bypassSnap ? rawPoint : [gridX, gridZ]
      setCursorPosition(gridPosition)
      setLevelY(event.localPosition[1])
      const lastPoint = points[points.length - 1]
      // 15° angle snap from the raw cursor (matching the 2D floorplan
      // pipeline) with the distance snapped along the ray to the grid step.
      const orthoPoint: [number, number] =
        bypassSnap || !lastPoint
          ? gridPosition
          : [
              ...snapPointAlongAngleRay(
                lastPoint,
                rawPoint,
                DEFAULT_ANGLE_STEP,
                useEditor.getState().gridSnapStep,
              ),
            ]
      const displayPoint = resolveSlabPlanPointSnap({
        rawPoint,
        fallbackPoint: orthoPoint,
        levelId: currentLevelId,
        altKey: event.nativeEvent?.altKey === true,
        shiftKey: bypassSnap,
      }).point
      setSnappedCursorPosition(displayPoint)
      if (
        !bypassSnap &&
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
        const slabId = commitSlabDrawing(currentLevelId, points)
        setSelection({ selectedIds: [slabId] })
        setPoints([])
        clearSlabSnapFeedback()
      } else {
        // Every non-closing vertex is a "start" tick; the closing click above
        // fires the structure-build (end) cue.
        triggerSFX('sfx:structure-build-start')
        setPoints([...points, clickPoint])
      }
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId) return
      if (points.length >= 3) {
        const slabId = commitSlabDrawing(currentLevelId, points)
        setSelection({ selectedIds: [slabId] })
        setPoints([])
        clearSlabSnapFeedback()
      }
    }

    const onCancel = () => {
      if (points.length > 0) markToolCancelConsumed()
      setPoints([])
      clearSlabSnapFeedback()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = false
    }
    const onWindowBlur = () => {
      shiftPressed.current = false
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [currentLevelId, points, cursorPosition, setSelection])

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
